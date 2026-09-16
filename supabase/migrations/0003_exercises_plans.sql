-- ---------------------------------------------------------------------------
-- exercises (global catalogue + optional per-team custom exercises)
-- ---------------------------------------------------------------------------
create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams (id) on delete cascade,
  name text not null,
  muscle_group text not null check (muscle_group in (
    'chest', 'back', 'legs', 'shoulders', 'biceps', 'triceps', 'abs', 'full_body', 'cardio'
  )),
  equipment text,
  exercise_type text not null default 'strength' check (exercise_type in ('strength', 'cardio', 'mobility', 'other')),
  instructions text,
  default_sets smallint default 3,
  default_reps smallint default 10,
  media_url text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index exercises_team_id_idx on public.exercises (team_id);
create index exercises_muscle_group_idx on public.exercises (muscle_group);

create trigger exercises_set_updated_at
  before update on public.exercises
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- workout_plans / workout_plan_days / workout_plan_exercises
-- ---------------------------------------------------------------------------
create table public.workout_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null default 'Standardplan',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workout_plans_user_id_idx on public.workout_plans (user_id);

create trigger workout_plans_set_updated_at
  before update on public.workout_plans
  for each row execute function public.set_updated_at();

create table public.workout_plan_days (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.workout_plans (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7), -- 1 = Montag ... 7 = Sonntag
  title text not null default '',
  is_rest_day boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, weekday)
);

create trigger workout_plan_days_set_updated_at
  before update on public.workout_plan_days
  for each row execute function public.set_updated_at();

create table public.workout_plan_exercises (
  id uuid primary key default gen_random_uuid(),
  plan_day_id uuid not null references public.workout_plan_days (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete restrict,
  position smallint not null default 0,
  target_sets smallint,
  target_reps smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workout_plan_exercises_plan_day_id_idx on public.workout_plan_exercises (plan_day_id);

create trigger workout_plan_exercises_set_updated_at
  before update on public.workout_plan_exercises
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.exercises enable row level security;
alter table public.workout_plans enable row level security;
alter table public.workout_plan_days enable row level security;
alter table public.workout_plan_exercises enable row level security;

-- exercises: global (team_id null) exercises are readable by any authenticated
-- user; team-specific custom exercises are readable by that team's members.
-- Only team admins may create/edit exercises for their team; global catalogue
-- rows are managed via migrations/seed, not client writes.
create policy "exercises_select" on public.exercises
  for select using (
    team_id is null or public.is_team_member(team_id)
  );

create policy "exercises_admin_insert" on public.exercises
  for insert with check (team_id is not null and public.is_team_admin(team_id));

create policy "exercises_admin_update" on public.exercises
  for update using (team_id is not null and public.is_team_admin(team_id));

create policy "exercises_admin_delete" on public.exercises
  for delete using (team_id is not null and public.is_team_admin(team_id));

-- workout_plans: strictly private to the owner (a training plan can reveal
-- goals/health intent, so it is not team-shared).
create policy "workout_plans_owner_all" on public.workout_plans
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "workout_plan_days_owner_all" on public.workout_plan_days
  for all using (
    exists (select 1 from public.workout_plans p where p.id = plan_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.workout_plans p where p.id = plan_id and p.user_id = auth.uid())
  );

create policy "workout_plan_exercises_owner_all" on public.workout_plan_exercises
  for all using (
    exists (
      select 1 from public.workout_plan_days d
      join public.workout_plans p on p.id = d.plan_id
      where d.id = plan_day_id and p.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.workout_plan_days d
      join public.workout_plans p on p.id = d.plan_id
      where d.id = plan_day_id and p.user_id = auth.uid()
    )
  );
