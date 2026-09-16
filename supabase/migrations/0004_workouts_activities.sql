-- ---------------------------------------------------------------------------
-- workouts (structured, trackable sessions — sets/reps/weight)
-- ---------------------------------------------------------------------------
create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  plan_day_id uuid references public.workout_plan_days (id) on delete set null,
  activity_type text not null default 'krafttraining' check (activity_type in (
    'krafttraining', 'laufen', 'gehen', 'radfahren', 'schwimmen', 'cardio', 'fussball', 'fitnesskurs', 'sonstiges'
  )),
  status text not null default 'geplant' check (status in ('geplant', 'laeuft', 'abgeschlossen', 'uebersprungen')),
  title text,
  scheduled_date date,
  started_at timestamptz,
  finished_at timestamptz,
  duration_seconds int,
  distance_km numeric(6, 2),
  notes text,
  source text not null default 'manual' check (source in ('manual', 'apple_health', 'health_connect')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workouts_user_id_idx on public.workouts (user_id);
create index workouts_team_id_idx on public.workouts (team_id);
create index workouts_status_idx on public.workouts (status);
create index workouts_scheduled_date_idx on public.workouts (scheduled_date);

create trigger workouts_set_updated_at
  before update on public.workouts
  for each row execute function public.set_updated_at();

create table public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete restrict,
  position smallint not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workout_exercises_workout_id_idx on public.workout_exercises (workout_id);

create trigger workout_exercises_set_updated_at
  before update on public.workout_exercises
  for each row execute function public.set_updated_at();

create table public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references public.workout_exercises (id) on delete cascade,
  set_number smallint not null default 1,
  weight_kg numeric(6, 2),
  reps smallint,
  distance_km numeric(6, 2),
  duration_seconds int,
  completed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workout_sets_workout_exercise_id_idx on public.workout_sets (workout_exercise_id);

create trigger workout_sets_set_updated_at
  before update on public.workout_sets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- activities (lightweight, unstructured logs: a walk, a run, steps)
-- ---------------------------------------------------------------------------
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  activity_type text not null check (activity_type in (
    'krafttraining', 'laufen', 'gehen', 'radfahren', 'schwimmen', 'cardio', 'fussball', 'fitnesskurs', 'sonstiges'
  )),
  occurred_at timestamptz not null default now(),
  duration_seconds int,
  distance_km numeric(6, 2),
  steps int,
  calories_estimate int,
  source text not null default 'manual' check (source in ('manual', 'apple_health', 'health_connect')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index activities_user_id_idx on public.activities (user_id);
create index activities_team_id_idx on public.activities (team_id);
create index activities_occurred_at_idx on public.activities (occurred_at);

create trigger activities_set_updated_at
  before update on public.activities
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.workouts enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.workout_sets enable row level security;
alter table public.activities enable row level security;

-- Workouts are private to the owner. Team admins do NOT get read access here
-- (a workout can reveal health-adjacent detail); team-level visibility is
-- instead derived through the fitness_score_events / activity_feed tables,
-- which only carry opt-in, non-identifying-by-default summaries.
create policy "workouts_owner_all" on public.workouts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "workout_exercises_owner_all" on public.workout_exercises
  for all using (
    exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid())
  );

create policy "workout_sets_owner_all" on public.workout_sets
  for all using (
    exists (
      select 1 from public.workout_exercises we
      join public.workouts w on w.id = we.workout_id
      where we.id = workout_exercise_id and w.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.workout_exercises we
      join public.workouts w on w.id = we.workout_id
      where we.id = workout_exercise_id and w.user_id = auth.uid()
    )
  );

create policy "activities_owner_all" on public.activities
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
