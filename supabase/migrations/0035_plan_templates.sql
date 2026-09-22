-- Reusable plan templates: a personal, named snapshot of exercises + planned
-- targets that can be applied to any weekday. A template never references a
-- workout_plan_day/workout_plan_exercise row, so applying it always creates
-- an independent copy — editing or deleting that day, or the template
-- itself, cannot affect the other.
create table public.plan_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index plan_templates_user_id_idx on public.plan_templates (user_id);

create trigger plan_templates_set_updated_at
  before update on public.plan_templates
  for each row execute function public.set_updated_at();

create table public.plan_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.plan_templates (id) on delete cascade,
  -- set null (not restrict): deleting an exercise must never be blocked by a
  -- template referencing it. exercise_name is a snapshot so the item stays
  -- meaningful (and the template data is not silently lost) even then.
  exercise_id uuid references public.exercises (id) on delete set null,
  exercise_name text not null,
  position smallint not null default 0,
  target_sets smallint,
  target_reps smallint,
  target_weight_kg numeric(7,2) check (target_weight_kg is null or target_weight_kg >= 0),
  target_duration_seconds integer check (target_duration_seconds is null or target_duration_seconds > 0),
  target_distance_km numeric(7,2) check (target_distance_km is null or target_distance_km > 0),
  target_metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index plan_template_items_template_id_idx on public.plan_template_items (template_id);
create index plan_template_items_exercise_id_idx on public.plan_template_items (exercise_id);

create trigger plan_template_items_set_updated_at
  before update on public.plan_template_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: templates are strictly personal (same ownership model as
-- workout_plans / workout_plan_days / workout_plan_exercises).
-- ---------------------------------------------------------------------------
alter table public.plan_templates enable row level security;
alter table public.plan_template_items enable row level security;

create policy "plan_templates_owner_all" on public.plan_templates
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "plan_template_items_owner_all" on public.plan_template_items
  for all using (
    exists (select 1 from public.plan_templates t where t.id = template_id and t.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.plan_templates t where t.id = template_id and t.user_id = auth.uid())
  );
