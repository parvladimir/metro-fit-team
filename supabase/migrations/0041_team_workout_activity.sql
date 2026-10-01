-- ---------------------------------------------------------------------------
-- "Heute im Team": lets any team member see which teammates completed a
-- workout in a given window, to power a Home-screen activity card. workouts
-- RLS is strictly owner-only (0004_workouts_activities.sql) — a team member
-- can never read another member's workouts row directly — so, unlike
-- get_team_ranking (invoker, since fitness_score_events already has a
-- team-visible policy), this needs SECURITY DEFINER.
--
-- Joining to the workout's own chat system message (message_type='system',
-- event_type='workout_completed', written once by handle_workout_chat_events
-- in 0037_workout_pause_and_review_safety.sql) is what makes this safe and
-- correct with no extra predicates:
--   - privacy: post_team_system_event (0033) only ever writes that message
--     for a then-opted-in member, so an opted-out member's workout has no
--     message row and is excluded by the join alone;
--   - started/completed double-counting: only the 'workout_completed'
--     message is joined, never 'workout_started', so the join is 1:1 per
--     workout;
--   - pending duration-confirmation: such a workout never leaves
--     status='laeuft', so the status filter alone excludes it;
--   - deleted workouts: delete_own_workout (0033) hard-deletes the workout
--     row and soft-deletes its message, so either fact alone excludes it.
-- Current team membership is re-checked for the row owner, the same
-- "member may have since left" fix get_team_ranking already applies
-- (0019_ranking_excludes_removed_members.sql) — chat/workout rows outlive a
-- departure by design, so a stored team_id alone isn't enough.
-- ---------------------------------------------------------------------------

create index if not exists workouts_team_status_finished_idx
  on public.workouts (team_id, finished_at)
  where status = 'abgeschlossen';

create or replace function public.get_team_workout_activity(
  p_team_id uuid, p_range_start timestamptz, p_range_end timestamptz
)
returns table (
  workout_id uuid,
  user_id uuid,
  full_name text,
  avatar_url text,
  activity_type text,
  title text,
  finished_at timestamptz,
  duration_seconds int,
  duration_source text,
  message_id uuid
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_team_member(p_team_id) then
    raise exception 'not_a_team_member' using errcode = '42501';
  end if;

  return query
    select w.id, w.user_id, p.full_name, p.avatar_url, w.activity_type, w.title,
           w.finished_at, w.duration_seconds, w.duration_source, m.id
    from public.workouts w
    join public.messages m
      on m.workout_id = w.id
     and m.message_type = 'system'
     and m.event_type = 'workout_completed'
     and m.deleted_at is null
    join public.profiles p on p.id = w.user_id
    where w.team_id = p_team_id
      and w.status = 'abgeschlossen'
      and w.finished_at >= p_range_start
      and w.finished_at < p_range_end
      and exists (
        select 1 from public.team_members tm
        where tm.team_id = w.team_id and tm.user_id = w.user_id
      )
    order by w.finished_at desc;
end;
$$;

revoke all on function public.get_team_workout_activity(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_team_workout_activity(uuid, timestamptz, timestamptz) to authenticated;

-- Conservative "N Training(s) wird/werden gerade aufgezeichnet" count: only a
-- genuinely running (not paused, not long-stale) session counts as "live".
-- 180 minutes mirrors LONG_WORKOUT_CONFIRM_MINUTES (src/lib/workout-timer.ts)
-- / the 10800-second gate in 0037 — an older open timer is already past the
-- point this app asks the owner to confirm it, so it's never advertised as
-- "happening now" to teammates either.
create or replace function public.get_team_running_count(p_team_id uuid)
returns bigint
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_count bigint;
begin
  if not public.is_team_member(p_team_id) then
    raise exception 'not_a_team_member' using errcode = '42501';
  end if;

  select count(*) into v_count
  from public.workouts w
  join public.messages m
    on m.workout_id = w.id
   and m.message_type = 'system'
   and m.event_type = 'workout_started'
   and m.deleted_at is null
  where w.team_id = p_team_id
    and w.status = 'laeuft'
    and w.paused_at is null
    and w.started_at >= now() - interval '180 minutes'
    and exists (
      select 1 from public.team_members tm
      where tm.team_id = w.team_id and tm.user_id = w.user_id
    );

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.get_team_running_count(uuid) from public, anon;
grant execute on function public.get_team_running_count(uuid) to authenticated;
