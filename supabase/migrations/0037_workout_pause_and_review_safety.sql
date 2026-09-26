-- ---------------------------------------------------------------------------
-- Workout timer reliability: explicit pause/resume, a validated finish RPC
-- (replacing a raw client update with zero bounds/confirmation), one active
-- workout per user, and a defense-in-depth guard against a duration being
-- forged directly via the client SDK (a pre-existing gap: workouts RLS is a
-- flat owner-all policy with no value bounds at all).
--
-- Status stays 'laeuft' throughout running AND paused — no new status value.
-- Both on_workout_status_change and on_workout_chat_events are
-- `after update OF status`, which only fires when `status` appears in the
-- UPDATE's SET list. pause_own_workout/resume_own_workout never touch
-- `status`, so neither trigger fires for them: zero changes needed there.
-- ---------------------------------------------------------------------------

-- 1. Pause tracking + duration provenance.
alter table public.workouts
  add column if not exists paused_at timestamptz,
  add column if not exists paused_seconds integer not null default 0 check (paused_seconds >= 0),
  add column if not exists duration_source text not null default 'timer' check (duration_source in ('timer', 'corrected')),
  add column if not exists long_duration_confirmed_at timestamptz;

-- 2. One active workout per user. Also serves as the lookup index for
-- "does this user already have one running" checks in the app.
-- NOTE for whoever runs the production deploy workflow: this will fail
-- loudly (the correct, safe outcome) if any user already has two 'laeuft'
-- rows in production. Check first:
--   select user_id, count(*) from workouts where status = 'laeuft' group by user_id having count(*) > 1;
create unique index if not exists workouts_one_active_per_user_uq
  on public.workouts (user_id) where status = 'laeuft';

-- 3. Explicit pause/resume. Idempotent (a WHERE guard makes a double-tap a
-- harmless no-op); ownership is checked explicitly and raises, but "already
-- in the target state" is not an error. resume's increment must happen
-- server-side in one statement — the JS client can't express
-- `paused_seconds = paused_seconds + <computed>`.
create or replace function public.pause_own_workout(p_workout_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select user_id into v_owner from public.workouts where id = p_workout_id;
  if not found or v_owner <> auth.uid() then raise exception 'not_owner' using errcode = '42501'; end if;

  update public.workouts set paused_at = now()
  where id = p_workout_id and status = 'laeuft' and paused_at is null;
end;
$$;

create or replace function public.resume_own_workout(p_workout_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select user_id into v_owner from public.workouts where id = p_workout_id;
  if not found or v_owner <> auth.uid() then raise exception 'not_owner' using errcode = '42501'; end if;

  update public.workouts
  set paused_seconds = paused_seconds + greatest(0, extract(epoch from (now() - paused_at))::int),
      paused_at = null
  where id = p_workout_id and status = 'laeuft' and paused_at is not null;
end;
$$;

-- 4. Validated finish — replaces finishWorkoutAction's raw, unbounded
-- `.update()`. Locks the row so two devices finishing at once serialize
-- safely; a retry against an already-completed workout succeeds silently
-- rather than double-processing (the scoring trigger only fires on the
-- transition edge into 'abgeschlossen', so a no-op update can't re-award).
-- duration_source is derived here, never trusted from the client: compares
-- the submitted duration against what the persisted timer math would
-- produce (accounting for a still-open pause, so review time never counts).
create or replace function public.finish_own_workout(
  p_workout_id uuid,
  p_finished_at timestamptz,
  p_duration_seconds int,
  p_distance_km numeric,
  p_notes text,
  p_confirm_long boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_w public.workouts%rowtype;
  v_timer_seconds int;
  v_source text;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  select * into v_w from public.workouts where id = p_workout_id for update;
  if not found or v_w.user_id <> auth.uid() then raise exception 'not_owner' using errcode = '42501'; end if;
  if v_w.status = 'abgeschlossen' then return; end if;
  if v_w.status <> 'laeuft' then raise exception 'not_running' using errcode = '22023'; end if;

  -- Note: p_finished_at is only ever compared to `now()`, never strictly to
  -- v_w.started_at — the review screen's end-time input is minute-precision
  -- (no seconds), so a reconstructed finished_at can legitimately land a few
  -- seconds before the exact started_at for a very short workout. duration_
  -- seconds (bounds-checked below) is the authoritative value; this mirrors
  -- update_own_workout, which has never compared finished_at to started_at.
  if p_duration_seconds is null or p_duration_seconds < 1 or p_duration_seconds > 86400
     or p_finished_at is null or p_finished_at > now() + interval '1 hour' then
    raise exception 'invalid_workout_data' using errcode = '22023';
  end if;

  if p_duration_seconds >= 10800 and not p_confirm_long then
    raise exception 'confirmation_required' using errcode = '22023';
  end if;

  v_timer_seconds := greatest(0,
    extract(epoch from (p_finished_at - v_w.started_at))::int
    - v_w.paused_seconds
    - case when v_w.paused_at is not null
           then greatest(0, extract(epoch from (p_finished_at - v_w.paused_at))::int)
           else 0 end);
  v_source := case when abs(p_duration_seconds - v_timer_seconds) <= 5 then 'timer' else 'corrected' end;

  update public.workouts
  set status = 'abgeschlossen',
      finished_at = p_finished_at,
      duration_seconds = p_duration_seconds,
      distance_km = p_distance_km,
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      duration_source = v_source,
      long_duration_confirmed_at = case when p_duration_seconds >= 10800 then now() else null end,
      paused_at = null
  where id = p_workout_id;
end;
$$;

revoke all on function public.pause_own_workout(uuid) from public, anon;
revoke all on function public.resume_own_workout(uuid) from public, anon;
revoke all on function public.finish_own_workout(uuid, timestamptz, int, numeric, text, boolean) from public, anon;
grant execute on function public.pause_own_workout(uuid) to authenticated;
grant execute on function public.resume_own_workout(uuid) to authenticated;
grant execute on function public.finish_own_workout(uuid, timestamptz, int, numeric, text, boolean) to authenticated;

-- 5. update_own_workout gains the same >=180min confirmation gate (the task
-- requires this for edits too, not only the initial finish) and keeps the
-- linked chat event's started_at/duration_source in sync alongside the
-- duration_minutes it already refreshed. Adding a parameter changes the
-- function's signature, so it must be dropped and recreated (same pattern
-- already used for post_team_system_event in 0033_workout_edit_delete.sql).
drop function if exists public.update_own_workout(uuid, text, timestamptz, int, numeric, text);

create or replace function public.update_own_workout(
  p_workout_id uuid, p_title text, p_finished_at timestamptz, p_duration_seconds int, p_distance_km numeric, p_notes text,
  p_confirm_long boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_w public.workouts%rowtype;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_minutes int;
  v_old_week date;
  v_new_week date;
  v_source text;
  v_started timestamptz;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into v_w from public.workouts where id = p_workout_id;
  if not found or v_w.user_id <> auth.uid() then raise exception 'not_owner' using errcode = '42501'; end if;
  if v_w.status <> 'abgeschlossen' then raise exception 'not_completed' using errcode = '22023'; end if;
  if p_duration_seconds is null or p_duration_seconds < 1 or p_duration_seconds > 86400
     or p_finished_at is null or p_finished_at > now() + interval '1 hour' then
    raise exception 'invalid_workout_data' using errcode = '22023';
  end if;
  if p_duration_seconds >= 10800 and not p_confirm_long then
    raise exception 'confirmation_required' using errcode = '22023';
  end if;

  v_old_week := date_trunc('week', v_w.finished_at)::date;
  v_new_week := date_trunc('week', p_finished_at)::date;
  v_minutes := round(p_duration_seconds / 60.0);
  v_started := p_finished_at - make_interval(secs => p_duration_seconds);
  v_source := case when p_duration_seconds = v_w.duration_seconds then v_w.duration_source else 'corrected' end;

  update public.workouts
  set title = v_title,
      finished_at = p_finished_at,
      started_at = v_started,
      duration_seconds = p_duration_seconds,
      distance_km = p_distance_km,
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      scheduled_date = p_finished_at::date,
      duration_source = v_source,
      long_duration_confirmed_at = case when p_duration_seconds >= 10800 then coalesce(v_w.long_duration_confirmed_at, now()) else null end
  where id = p_workout_id;

  -- Keep the visible team event in sync (in place: no new message, no push,
  -- no unread change).
  update public.messages
  set metadata = metadata || jsonb_build_object('title', v_title)
                          || case when event_type = 'workout_completed'
                             then jsonb_build_object('duration_minutes', v_minutes, 'started_at', v_started, 'duration_source', v_source)
                             else '{}'::jsonb end
  where workout_id = p_workout_id and message_type = 'system' and event_type in ('workout_started', 'workout_completed');

  update public.activity_feed
  set params = params || jsonb_build_object('durationMinutes', v_minutes)
  where workout_id = p_workout_id and event_type = 'workout_completed';

  perform public.recompute_workout_scores(v_w.user_id, v_old_week);
  if v_new_week <> v_old_week then
    perform public.recompute_workout_scores(v_w.user_id, v_new_week);
  end if;
  if v_w.team_id is not null then
    perform public.recompute_challenge_progress(v_w.user_id, v_w.team_id);
  end if;
  perform public.revoke_stale_achievements(v_w.user_id);

  insert into public.audit_events (team_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_w.team_id, auth.uid(), 'workout_edited', 'workout', p_workout_id, '{}'::jsonb);
end;
$$;

revoke all on function public.update_own_workout(uuid, text, timestamptz, int, numeric, text, boolean) from public, anon;
grant execute on function public.update_own_workout(uuid, text, timestamptz, int, numeric, text, boolean) to authenticated;

-- 6. workout_completed chat-event metadata gains started_at (so the chat
-- card can show "Beginn: HH:MM" without an extra per-message query — it's
-- already batched, embedded right in the message row) and duration_source.
-- Body is otherwise an exact copy-forward from 0033_workout_edit_delete.sql.
create or replace function public.handle_workout_chat_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week_start date;
  v_done int;
  v_goal int;
  v_title text;
begin
  if new.team_id is null then return new; end if;
  v_title := nullif(btrim(coalesce(new.title, '')), '');

  if new.status = 'laeuft' then
    if tg_op = 'UPDATE' then
      if old.status = 'laeuft' then return new; end if;
    end if;
    perform public.post_team_system_event(
      new.team_id, new.user_id, 'workout_started', 'hat ein Training gestartet',
      jsonb_build_object('title', v_title, 'activity_type', new.activity_type), new.id
    );
  end if;

  if tg_op = 'UPDATE' and new.status = 'abgeschlossen' and old.status is distinct from 'abgeschlossen' then
    perform public.post_team_system_event(
      new.team_id, new.user_id, 'workout_completed', 'hat ein Training abgeschlossen',
      jsonb_build_object(
        'title', v_title, 'activity_type', new.activity_type,
        'duration_minutes', round(coalesce(new.duration_seconds, 0) / 60.0),
        'started_at', new.started_at,
        'duration_source', new.duration_source
      ), new.id
    );

    v_week_start := date_trunc('week', coalesce(new.finished_at, now()))::date;
    select count(*) into v_done from public.workouts
      where user_id = new.user_id and status = 'abgeschlossen'
        and finished_at >= v_week_start and finished_at < v_week_start + interval '7 days';
    select weekly_goal into v_goal from public.profiles where id = new.user_id;

    if v_done = coalesce(v_goal, 3) then
      perform public.post_team_system_event(
        new.team_id, new.user_id, 'weekly_goal_reached', 'hat das Wochenziel erreicht', '{}'::jsonb, new.id
      );
    end if;
  end if;

  return new;
end;
$$;

-- 7. Defense in depth: closes a real pre-existing gap where any authenticated
-- user could set their own workout's duration_seconds to an arbitrary value
-- via a direct client update (workouts RLS is ownership-only, no value
-- bounds). Mirrors guard_message_update's exact shape and bypass condition
-- (0033_workout_edit_delete.sql) — every legitimate writer above is
-- SECURITY DEFINER and runs as the function owner, so current_user is never
-- 'authenticated'/'anon' inside them and this guard never blocks a
-- legitimate path.
create or replace function public.guard_workout_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null or current_user not in ('authenticated', 'anon') then return new; end if;

  if new.paused_at is distinct from old.paused_at
     or new.paused_seconds is distinct from old.paused_seconds
     or new.duration_source is distinct from old.duration_source
     or new.long_duration_confirmed_at is distinct from old.long_duration_confirmed_at then
    raise exception 'immutable_workout_field' using errcode = '42501';
  end if;

  if new.status = 'abgeschlossen' then
    if new.duration_seconds is null or new.duration_seconds < 1 or new.duration_seconds > 86400 then
      raise exception 'invalid_workout_duration' using errcode = '22023';
    end if;
    if new.duration_seconds >= 10800 and new.long_duration_confirmed_at is null then
      raise exception 'confirmation_required' using errcode = '22023';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists on_workout_update_guard on public.workouts;
create trigger on_workout_update_guard
  before update on public.workouts
  for each row execute function public.guard_workout_update();
