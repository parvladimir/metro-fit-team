-- Optional planned targets per plan exercise. target_sets / target_reps stay
-- as they are (legacy plans keep working); new typed targets sit beside them.
-- Planned values never share columns with logged results (workout_sets).
alter table public.workout_plan_exercises
  add column if not exists target_weight_kg numeric(7,2) check (target_weight_kg is null or target_weight_kg >= 0),
  add column if not exists target_duration_seconds integer check (target_duration_seconds is null or target_duration_seconds > 0),
  add column if not exists target_distance_km numeric(7,2) check (target_distance_km is null or target_distance_km > 0),
  add column if not exists target_metrics jsonb not null default '{}'::jsonb;

-- Snapshot of the plan target at workout start, so later plan edits do not
-- rewrite what a finished workout was compared against. Guidance only.
alter table public.workout_exercises
  add column if not exists planned jsonb;
