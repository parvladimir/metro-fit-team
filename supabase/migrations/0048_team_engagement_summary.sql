-- ---------------------------------------------------------------------------
-- get_team_engagement_summary — a minimal, AGGREGATE-ONLY weekly evaluation
-- for team admins. One row per Berlin calendar week (Monday–Sunday), newest
-- first, containing only counts:
--
--   active_participants        members with at least one completed workout
--   returning_participants     of those, the ones also active the week before
--   supported_workouts         completed workouts that a teammate reacted to or
--                              replied to (the "someone noticed" signal)
--   goal_reached_members       members whose completed workouts reached their
--                              own weekly goal
--   missions_*                 Wochenmissionen that started that week
--   duels_*                    Freundschaftsduelle that started that week
--   training_invites_created   "Wer ist dabei?" invitations created that week
--
-- There is deliberately NO name, user id, per-person value, score or text in
-- the result, and nothing about a duel's OUTCOME (those stay private between
-- its two participants) or about who answered an invitation. Admin-only
-- (same 0027 idiom): a regular member, an admin of another team and an
-- anonymous caller are all refused.
--
-- Same inclusion rules as the team-wide features: only CURRENT members whose
-- activity is shared (activity_feed_opt_in, missing = shared) are counted, so
-- this adds no new way to learn that someone who opted out trained.
-- `counted_members` vs `member_count` makes that visible.
--
-- What this is NOT: it cannot tell real users from demo/test accounts (nothing
-- in the database marks them), and the numbers make no claim about fitness
-- improvement or motivation — they are raw counts. On a very small team a
-- count can point at one person; the admin page says so.
--
-- Weeks are Berlin weeks (date_trunc on the Berlin wall clock, never a UTC
-- cast), so a Sunday-23:30 and a Monday-00:30 workout land in different weeks
-- and a daylight-saving week still spans exactly Monday to Sunday.
-- ---------------------------------------------------------------------------
create or replace function public.get_team_engagement_summary(p_team_id uuid, p_weeks int default 8)
returns table (
  week_start date,
  in_progress boolean,
  member_count int,
  counted_members int,
  active_participants int,
  returning_participants int,
  supported_workouts int,
  goal_reached_members int,
  missions_started int,
  missions_reached int,
  missions_cancelled int,
  duels_accepted int,
  duels_finished int,
  training_invites_created int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_weeks int := least(greatest(coalesce(p_weeks, 8), 1), 26);
  v_today date := (clock_timestamp() at time zone 'Europe/Berlin')::date;
  v_this_monday date := date_trunc('week', v_today::timestamp)::date;
  -- One extra week back so "returning" is defined for the oldest week shown too.
  v_first_monday date := v_this_monday - (v_weeks * 7);
  v_range_start timestamptz := (v_this_monday - (v_weeks * 7))::timestamp at time zone 'Europe/Berlin';
begin
  if auth.uid() is null or not public.is_team_admin(p_team_id) then
    raise exception 'not_team_admin' using errcode = '42501';
  end if;

  return query
  with weeks as (
    select (v_this_monday - (n * 7))::date as wk
    from generate_series(0, v_weeks - 1) as n
  ),
  roster as (
    select tm.user_id, coalesce(pr.weekly_goal, 3) as goal
    from public.team_members tm
    join public.profiles pr on pr.id = tm.user_id
    left join public.privacy_settings ps on ps.user_id = tm.user_id
    where tm.team_id = p_team_id
      and coalesce(ps.activity_feed_opt_in, true) = true
  ),
  per_member_week as (
    select w.user_id,
           date_trunc('week', w.finished_at at time zone 'Europe/Berlin')::date as wk,
           count(*)::int as n
    from public.workouts w
    join roster r on r.user_id = w.user_id
    where w.team_id = p_team_id
      and w.status = 'abgeschlossen'
      and w.finished_at >= v_range_start
    group by 1, 2
  ),
  supported as (
    select date_trunc('week', w.finished_at at time zone 'Europe/Berlin')::date as wk,
           count(distinct m.id)::int as n
    from public.messages m
    join public.workouts w on w.id = m.workout_id
    join roster r on r.user_id = m.user_id
    where m.team_id = p_team_id
      and m.message_type = 'system'
      and m.event_type = 'workout_completed'
      and m.deleted_at is null
      and w.status = 'abgeschlossen'
      and w.finished_at >= v_range_start
      and (
        exists (
          select 1
          from public.message_reactions mr
          where mr.message_id = m.id
            and mr.user_id <> m.user_id
            and public.team_has_member(p_team_id, mr.user_id)
        )
        or exists (
          select 1
          from public.messages rep
          where rep.parent_message_id = m.id
            and rep.message_type = 'text'
            and rep.deleted_at is null
            and rep.user_id <> m.user_id
            and public.team_has_member(p_team_id, rep.user_id)
        )
      )
    group by 1
  ),
  missions as (
    select date_trunc('week', mi.starts_at::timestamp)::date as wk,
           mi.cancelled_at is not null as cancelled,
           (mi.cancelled_at is null
            and public.get_team_mission_training_days(p_team_id, mi.starts_at, mi.ends_at) >= mi.target_days) as reached
    from public.team_missions mi
    where mi.team_id = p_team_id
      and mi.starts_at >= v_first_monday
  ),
  duels as (
    select date_trunc('week', d.starts_on::timestamp)::date as wk,
           (d.status = 'accepted' and d.ends_on < v_today) as finished
    from public.team_duels d
    where d.team_id = p_team_id
      and d.starts_on >= v_first_monday
      -- Only duels that were accepted at some point (a withdrawn or declined
      -- invitation never was one) and whose two people are both still members.
      and d.responded_at is not null
      and d.status in ('accepted', 'cancelled')
      and public.team_has_member(d.team_id, d.inviter_id)
      and public.team_has_member(d.team_id, d.invitee_id)
  ),
  invites as (
    select date_trunc('week', i.created_at at time zone 'Europe/Berlin')::date as wk,
           count(*)::int as n
    from public.training_invites i
    where i.team_id = p_team_id
      and i.created_at >= v_range_start
    group by 1
  )
  select
    w.wk,
    w.wk = v_this_monday,
    (select count(*)::int from public.team_members tm where tm.team_id = p_team_id),
    (select count(*)::int from roster),
    (select count(*)::int from per_member_week a where a.wk = w.wk),
    (select count(*)::int
       from per_member_week a
       join per_member_week b on b.user_id = a.user_id and b.wk = a.wk - 7
      where a.wk = w.wk),
    coalesce((select s.n from supported s where s.wk = w.wk), 0),
    (select count(*)::int
       from per_member_week a
       join roster r on r.user_id = a.user_id
      where a.wk = w.wk and a.n >= r.goal),
    (select count(*)::int from missions mi where mi.wk = w.wk),
    (select count(*)::int from missions mi where mi.wk = w.wk and mi.reached),
    (select count(*)::int from missions mi where mi.wk = w.wk and mi.cancelled),
    (select count(*)::int from duels d where d.wk = w.wk),
    (select count(*)::int from duels d where d.wk = w.wk and d.finished),
    coalesce((select iv.n from invites iv where iv.wk = w.wk), 0)
  from weeks w
  order by w.wk desc;
end;
$$;

revoke all on function public.get_team_engagement_summary(uuid, int) from public, anon;
grant execute on function public.get_team_engagement_summary(uuid, int) to authenticated;
