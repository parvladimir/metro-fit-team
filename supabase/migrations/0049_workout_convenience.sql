-- ---------------------------------------------------------------------------
-- Fewer taps during a workout, part 1: earlier results next to an exercise, and
-- replacing / postponing an exercise inside the CURRENT workout.
--
-- Nothing here is a new feature table. It adds
--   * two read functions (the user's own earlier results — one batched call for a
--     whole workout instead of one query per exercise card, and a small on-demand
--     history),
--   * two write functions that change only the running workout's exercise rows
--     (replace / postpone), each atomic, and
--   * two defence-in-depth guards so no code path — including a direct client
--     request, which the owner-only RLS policies would otherwise allow — can
--     relabel an already recorded set.
--
-- Every function is SECURITY INVOKER: the owner-only RLS on workouts,
-- workout_exercises, workout_sets and exercises stays the single source of truth for
-- who can see or change what, and the functions add the lifecycle rules RLS cannot
-- express (the workout must still be running; the replacement must be an exercise the
-- caller may use). Personal training history is deliberately NOT cut off at the team's
-- points_reset_at — that date concerns competition points, not what someone trained.
--
-- A replace / postpone takes the same row lock as finish_own_workout (the workout
-- row, FOR UPDATE), so a request that arrives while the workout is being finished
-- waits and is then refused with workout_not_active, never applied to a finished
-- workout. The plan, saved templates, the points ledger, the timer and the team feed
-- are not touched: the functions write only workout_exercises.
-- ---------------------------------------------------------------------------

-- "Which earlier results exist for this exercise" filters workout_exercises by exercise.
create index if not exists workout_exercises_exercise_id_idx on public.workout_exercises (exercise_id);

-- ---------------------------------------------------------------------------
-- Guards: a recorded set never changes its exercise.
-- ---------------------------------------------------------------------------
create or replace function public.guard_workout_exercise_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.exercise_id is distinct from old.exercise_id
     and exists (select 1 from public.workout_sets s where s.workout_exercise_id = old.id) then
    raise exception 'exercise_has_recorded_sets' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists workout_exercises_identity_guard on public.workout_exercises;
create trigger workout_exercises_identity_guard
  before update of exercise_id on public.workout_exercises
  for each row execute function public.guard_workout_exercise_identity();

create or replace function public.guard_workout_set_parent()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.workout_exercise_id is distinct from old.workout_exercise_id then
    raise exception 'set_parent_is_fixed' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists workout_sets_parent_guard on public.workout_sets;
create trigger workout_sets_parent_guard
  before update of workout_exercise_id on public.workout_sets
  for each row execute function public.guard_workout_set_parent();

-- ---------------------------------------------------------------------------
-- get_last_exercise_results: for every distinct exercise of ONE of the caller's own
-- workouts, the most recent earlier result — one exercise instance (a workout_exercises
-- row with recorded sets) of the latest COMPLETED workout that contained it.
-- Excludes the workout itself, running / skipped workouts and instances without
-- sets. If an exercise appears twice in that workout, the later instance (by
-- position) is returned; get_exercise_history lists them separately.
-- ---------------------------------------------------------------------------
create or replace function public.get_last_exercise_results(p_workout_id uuid)
returns table (
  out_exercise_id uuid,
  out_workout_id uuid,
  out_workout_exercise_id uuid,
  out_performed_at timestamptz,
  out_sets jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  select last.exercise_id, last.workout_id, last.workout_exercise_id, last.performed_at, last.sets
    from (
      select distinct we.exercise_id
        from public.workout_exercises we
        join public.workouts cur on cur.id = we.workout_id
       where we.workout_id = p_workout_id
         and cur.user_id = auth.uid()
    ) wanted
    cross join lateral (
      select we2.exercise_id,
             w2.id as workout_id,
             we2.id as workout_exercise_id,
             w2.finished_at as performed_at,
             (select jsonb_agg(
                       jsonb_build_object(
                         'set_number', s.set_number,
                         'weight_kg', s.weight_kg,
                         'reps', s.reps,
                         'distance_km', s.distance_km,
                         'duration_seconds', s.duration_seconds,
                         'metrics', s.metrics
                       )
                       order by s.set_number, s.created_at, s.id)
                from public.workout_sets s
               where s.workout_exercise_id = we2.id and s.completed) as sets
        from public.workout_exercises we2
        join public.workouts w2 on w2.id = we2.workout_id
       where we2.exercise_id = wanted.exercise_id
         and w2.user_id = auth.uid()
         and w2.status = 'abgeschlossen'
         and w2.finished_at is not null
         and w2.id <> p_workout_id
         and exists (select 1 from public.workout_sets s2 where s2.workout_exercise_id = we2.id and s2.completed)
       order by w2.finished_at desc, we2.position desc, we2.id desc
       limit 1
    ) last;
$$;

-- ---------------------------------------------------------------------------
-- get_exercise_history: the caller's own earlier completed sessions of one exercise,
-- newest first — the p_limit most recent WORKOUTS (1..20, default 5), every instance
-- of the exercise in each of them listed separately. p_before pages further back.
-- ---------------------------------------------------------------------------
create or replace function public.get_exercise_history(
  p_exercise_id uuid,
  p_exclude_workout_id uuid default null,
  p_limit integer default 5,
  p_before timestamptz default null
)
returns table (
  out_workout_id uuid,
  out_workout_exercise_id uuid,
  out_performed_at timestamptz,
  out_instance_no integer,
  out_instance_count integer,
  out_sets jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with recent as (
    select w.id, w.finished_at
      from public.workouts w
     where w.user_id = auth.uid()
       and w.status = 'abgeschlossen'
       and w.finished_at is not null
       and (p_exclude_workout_id is null or w.id <> p_exclude_workout_id)
       and (p_before is null or w.finished_at < p_before)
       and exists (
         select 1
           from public.workout_exercises we
           join public.workout_sets s on s.workout_exercise_id = we.id and s.completed
          where we.workout_id = w.id and we.exercise_id = p_exercise_id
       )
     order by w.finished_at desc, w.id desc
     limit greatest(1, least(coalesce(p_limit, 5), 20))
  ),
  inst as (
    select we.id as we_id,
           we.workout_id,
           r.finished_at,
           row_number() over (partition by we.workout_id order by we.position, we.created_at, we.id) as instance_no,
           count(*) over (partition by we.workout_id) as instance_count
      from public.workout_exercises we
      join recent r on r.id = we.workout_id
     where we.exercise_id = p_exercise_id
       and exists (select 1 from public.workout_sets s where s.workout_exercise_id = we.id and s.completed)
  )
  select i.workout_id,
         i.we_id,
         i.finished_at,
         i.instance_no::integer,
         i.instance_count::integer,
         (select jsonb_agg(
                   jsonb_build_object(
                     'set_number', s.set_number,
                     'weight_kg', s.weight_kg,
                     'reps', s.reps,
                     'distance_km', s.distance_km,
                     'duration_seconds', s.duration_seconds,
                     'metrics', s.metrics
                   )
                   order by s.set_number, s.created_at, s.id)
            from public.workout_sets s
           where s.workout_exercise_id = i.we_id and s.completed)
    from inst i
   order by i.finished_at desc, i.workout_id desc, i.instance_no;
$$;

-- ---------------------------------------------------------------------------
-- replace_workout_exercise: swap an exercise of the RUNNING workout for another one.
--
--   no recorded sets   -> the replacement takes the original's place (a new row at the
--                         same position; the original row is removed)
--   recorded sets      -> the original and its sets stay exactly as they are; the
--                         replacement is added as a separate block right after it
--
-- The new row's id is chosen by the caller, which makes a double tap or a retried
-- request idempotent (the second call reports out_replayed = true). The original row's
-- exercise_id is never updated, so no set can ever be relabelled — not even by a set
-- being saved at the same moment: either that save commits first (and this call sees
-- the set and keeps the original), or this call commits first (and the save is refused
-- by the foreign key because the original row is gone).
-- ---------------------------------------------------------------------------
create or replace function public.replace_workout_exercise(
  p_workout_exercise_id uuid,
  p_new_exercise_id uuid,
  p_new_workout_exercise_id uuid
)
returns table (
  out_mode text,
  out_workout_exercise_id uuid,
  out_removed_workout_exercise_id uuid,
  out_replayed boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_workout_id uuid;
  v_status text;
  v_old public.workout_exercises%rowtype;
  v_new public.workout_exercises%rowtype;
  v_has_sets boolean;
  v_pos smallint;
  v_old_still_there boolean;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_workout_exercise_id is null or p_new_exercise_id is null or p_new_workout_exercise_id is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- RLS: only the owner can see these rows at all, so a foreign or unknown id is simply "not found".
  -- If the original row is already gone, this may be the repeat of a request that replaced it:
  -- the replacement row then tells which workout it was about.
  select we.workout_id into v_workout_id from public.workout_exercises we where we.id = p_workout_exercise_id;
  if v_workout_id is null then
    select we.workout_id into v_workout_id from public.workout_exercises we where we.id = p_new_workout_exercise_id;
  end if;
  if v_workout_id is null then raise exception 'exercise_not_found'; end if;

  -- Serialise with finishing / discarding / other replace and postpone calls of this workout.
  select w.status into v_status from public.workouts w where w.id = v_workout_id and w.user_id = auth.uid() for update;
  if not found then raise exception 'exercise_not_found'; end if;

  -- An identical retry of a request that already went through is reported again, never repeated
  -- (checked under the lock, so two identical requests arriving together cannot both insert).
  select * into v_new from public.workout_exercises where id = p_new_workout_exercise_id;
  if found then
    if v_new.exercise_id <> p_new_exercise_id or v_new.workout_id <> v_workout_id then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    v_old_still_there := exists (select 1 from public.workout_exercises where id = p_workout_exercise_id);
    return query select
      case when v_old_still_there then 'added' else 'replaced' end,
      v_new.id,
      case when v_old_still_there then null::uuid else p_workout_exercise_id end,
      true;
    return;
  end if;

  if v_status <> 'laeuft' then raise exception 'workout_not_active' using errcode = '22023'; end if;

  -- Re-read the row now that the lock is held: a concurrent request may have changed it.
  select * into v_old from public.workout_exercises where id = p_workout_exercise_id for update;
  if not found then raise exception 'exercise_not_found'; end if;

  -- The replacement must be an exercise this user may use (RLS on exercises).
  if not exists (select 1 from public.exercises where id = p_new_exercise_id) then
    raise exception 'exercise_not_accessible' using errcode = '42501';
  end if;
  if v_old.exercise_id = p_new_exercise_id then raise exception 'same_exercise' using errcode = '22023'; end if;

  select exists (select 1 from public.workout_sets where workout_exercise_id = v_old.id) into v_has_sets;

  -- Give every row of the workout a clear, unique position first (older rows may share one), so
  -- "the place of the original" is unambiguous.
  update public.workout_exercises we
     set position = o.new_pos
    from (
      select x.id,
             (row_number() over (order by x.position, x.created_at, x.id) - 1)::smallint as new_pos
        from public.workout_exercises x
       where x.workout_id = v_old.workout_id
    ) o
   where we.id = o.id and we.position is distinct from o.new_pos;
  select we.position into v_pos from public.workout_exercises we where we.id = v_old.id;

  if v_has_sets then
    -- The original and its sets stay; the replacement becomes the next block.
    update public.workout_exercises set position = position + 1 where workout_id = v_old.workout_id and position > v_pos;
    v_pos := v_pos + 1;
  else
    -- The replacement takes the original's slot.
    delete from public.workout_exercises where id = v_old.id;
  end if;

  begin
    insert into public.workout_exercises (id, workout_id, exercise_id, position, planned)
    values (p_new_workout_exercise_id, v_old.workout_id, p_new_exercise_id, v_pos, null);
  exception when unique_violation then
    raise exception 'invalid_request' using errcode = '22023';
  end;

  return query select
    case when v_has_sets then 'added' else 'replaced' end,
    p_new_workout_exercise_id,
    case when v_has_sets then null::uuid else v_old.id end,
    false;
end;
$$;

-- ---------------------------------------------------------------------------
-- postpone_workout_exercise: move one exercise of the RUNNING workout behind all the
-- others. The row itself (id, exercise, recorded sets, planned snapshot) is only
-- re-positioned, never deleted or re-created. Already the last one: nothing to do.
-- ---------------------------------------------------------------------------
create or replace function public.postpone_workout_exercise(p_workout_exercise_id uuid)
returns table (out_changed boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_workout_id uuid;
  v_status text;
  v_old public.workout_exercises%rowtype;
  v_is_last boolean;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_workout_exercise_id is null then raise exception 'invalid_request' using errcode = '22023'; end if;

  select we.workout_id into v_workout_id from public.workout_exercises we where we.id = p_workout_exercise_id;
  if v_workout_id is null then raise exception 'exercise_not_found'; end if;

  select w.status into v_status from public.workouts w where w.id = v_workout_id and w.user_id = auth.uid() for update;
  if not found then raise exception 'exercise_not_found'; end if;
  if v_status <> 'laeuft' then raise exception 'workout_not_active' using errcode = '22023'; end if;

  select * into v_old from public.workout_exercises where id = p_workout_exercise_id for update;
  if not found then raise exception 'exercise_not_found'; end if;

  select not exists (
    select 1
      from public.workout_exercises o
     where o.workout_id = v_old.workout_id
       and o.id <> v_old.id
       and (o.position, o.created_at, o.id) > (v_old.position, v_old.created_at, v_old.id)
  ) into v_is_last;
  if v_is_last then
    return query select false;
    return;
  end if;

  update public.workout_exercises we
     set position = o.new_pos
    from (
      select x.id,
             (row_number() over (
                order by case when x.id = p_workout_exercise_id then 1 else 0 end,
                         x.position, x.created_at, x.id) - 1)::smallint as new_pos
        from public.workout_exercises x
       where x.workout_id = v_old.workout_id
    ) o
   where we.id = o.id and we.position is distinct from o.new_pos;

  return query select true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: signed-in users only (the functions still act only on the caller's own rows).
-- ---------------------------------------------------------------------------
revoke all on function public.get_last_exercise_results(uuid) from public, anon;
grant execute on function public.get_last_exercise_results(uuid) to authenticated;

revoke all on function public.get_exercise_history(uuid, uuid, integer, timestamptz) from public, anon;
grant execute on function public.get_exercise_history(uuid, uuid, integer, timestamptz) to authenticated;

revoke all on function public.replace_workout_exercise(uuid, uuid, uuid) from public, anon;
grant execute on function public.replace_workout_exercise(uuid, uuid, uuid) to authenticated;

revoke all on function public.postpone_workout_exercise(uuid) from public, anon;
grant execute on function public.postpone_workout_exercise(uuid) to authenticated;
