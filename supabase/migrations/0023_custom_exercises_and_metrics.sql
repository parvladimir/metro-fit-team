-- ---------------------------------------------------------------------------
-- Custom (user-owned) exercises + a real exercise-type system + structured
-- optional metrics on sets.
-- Backward compatible: existing rows keep working, legacy 'cardio' type is
-- still accepted and simply migrated below.
-- ---------------------------------------------------------------------------

-- Ownership: NULL owner = system/global (team_id null) or team exercise.
alter table public.exercises
  add column if not exists owner_user_id uuid references public.profiles (id) on delete cascade,
  add column if not exists is_custom boolean not null default false,
  add column if not exists visibility text not null default 'global'
    check (visibility in ('global', 'team', 'private')),
  add column if not exists notes text;

create index if not exists exercises_owner_user_id_idx on public.exercises (owner_user_id);

-- Drop the old type / muscle_group check constraints by definition lookup
-- (their auto-generated names are not guaranteed), then re-add wider ones.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.exercises'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) ilike '%exercise_type%' or pg_get_constraintdef(oid) ilike '%muscle_group%')
  loop
    execute format('alter table public.exercises drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.exercises
  add constraint exercises_exercise_type_check check (exercise_type in (
    'strength', 'bodyweight', 'cardio_distance', 'cardio_time', 'interval', 'mobility', 'sport', 'other', 'cardio'
  )),
  add constraint exercises_muscle_group_check check (muscle_group in (
    'chest', 'back', 'legs', 'shoulders', 'biceps', 'triceps', 'abs', 'full_body', 'cardio', 'other'
  ));

-- Re-classify the global catalogue (metadata only; ids are unchanged so every
-- existing plan / workout keeps pointing at the same rows).
update public.exercises set exercise_type = 'bodyweight'
  where team_id is null and owner_user_id is null
    and name in ('Liegestütze', 'Klimmzüge', 'Dips', 'Crunches', 'Plank', 'Beinheben hängend', 'Burpees');
update public.exercises set exercise_type = 'cardio_time'
  where team_id is null and owner_user_id is null and name = 'Seilspringen';
update public.exercises set exercise_type = 'cardio_distance'
  where exercise_type = 'cardio' and name <> 'Seilspringen';

-- RLS: private custom exercises are visible/editable only by their owner.
drop policy if exists "exercises_select" on public.exercises;
create policy "exercises_select" on public.exercises
  for select using (
    (owner_user_id is null and (team_id is null or public.is_team_member(team_id)))
    or owner_user_id = auth.uid()
  );

drop policy if exists "exercises_owner_insert" on public.exercises;
create policy "exercises_owner_insert" on public.exercises
  for insert with check (
    owner_user_id = auth.uid() and team_id is null and is_custom = true
    and visibility = 'private' and created_by = auth.uid()
  );

drop policy if exists "exercises_owner_update" on public.exercises;
create policy "exercises_owner_update" on public.exercises
  for update using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid() and team_id is null and is_custom = true);

drop policy if exists "exercises_owner_delete" on public.exercises;
create policy "exercises_owner_delete" on public.exercises
  for delete using (owner_user_id = auth.uid());

-- Team-admin policies stay, but must never touch someone's private exercise.
drop policy if exists "exercises_admin_update" on public.exercises;
create policy "exercises_admin_update" on public.exercises
  for update using (team_id is not null and owner_user_id is null and public.is_team_admin(team_id));
drop policy if exists "exercises_admin_delete" on public.exercises;
create policy "exercises_admin_delete" on public.exercises
  for delete using (team_id is not null and owner_user_id is null and public.is_team_admin(team_id));

-- ---------------------------------------------------------------------------
-- Sets: keep the typed "core" columns that personal records need
-- (weight_kg, reps, distance_km, duration_seconds) and put every optional /
-- type-specific value into a jsonb bag instead of dozens of nullable columns.
-- metrics keys used by the app: rpe, rest_seconds, calories, avg_heart_rate,
-- max_heart_rate, elevation_gain_m, incline_pct, rounds, work_seconds,
-- interval_rest_seconds.
-- ---------------------------------------------------------------------------
alter table public.workout_sets
  add column if not exists metrics jsonb not null default '{}'::jsonb,
  add column if not exists notes text;

-- Prepared for personal records (heaviest lift, fastest distance, longest ride).
create index if not exists workout_sets_weight_idx on public.workout_sets (workout_exercise_id, weight_kg desc nulls last);
