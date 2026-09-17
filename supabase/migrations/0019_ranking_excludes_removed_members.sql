-- ---------------------------------------------------------------------------
-- Fix: get_team_ranking() summed fitness_score_events/fitness_score_totals
-- by team_id alone, with no check that the user was still a current member
-- of that team. Removing someone from team_members (or deleting their
-- account) never deletes their historical score rows (by design, so a
-- user's own stats survive if they leave and rejoin) — but that meant a
-- removed member's name and full point total kept appearing in the live
-- leaderboard forever. Discovered live: 5 profiles with zero team_members
-- rows for METRO Marl Fitness Team still had 70 fitness_score_events rows
-- and 15 fitness_score_totals rows counted into its ranking.
--
-- Fix: only count rows for user_ids that are still a team_members row for
-- that same team. Historical score rows themselves are left untouched (so
-- rejoining restores prior history) — they're just excluded from the
-- ranking view once the membership is gone, matching "exclude deleted/
-- removed users from active rankings, keep historical data for integrity".
-- ---------------------------------------------------------------------------
create or replace function public.get_team_ranking(p_team_id uuid, p_period text default 'current_week')
returns table (user_id uuid, points bigint)
language plpgsql
security invoker
stable
set search_path = public
as $$
declare
  v_iso_year int;
  v_iso_week int;
begin
  if not public.is_team_member(p_team_id) then
    raise exception 'not_a_team_member' using errcode = '42501';
  end if;

  if p_period = 'current_week' then
    return query
      select t.user_id, sum(t.points)::bigint as points
      from public.fitness_score_totals t
      where t.team_id = p_team_id
        and t.iso_year = extract(isoyear from current_date)::int
        and t.iso_week = extract(week from current_date)::int
        and exists (
          select 1 from public.team_members tm
          where tm.team_id = t.team_id and tm.user_id = t.user_id
        )
      group by t.user_id
      order by points desc;

  elsif p_period = 'last_week' then
    v_iso_year := extract(isoyear from current_date - interval '7 days')::int;
    v_iso_week := extract(week from current_date - interval '7 days')::int;
    return query
      select t.user_id, sum(t.points)::bigint as points
      from public.fitness_score_totals t
      where t.team_id = p_team_id and t.iso_year = v_iso_year and t.iso_week = v_iso_week
        and exists (
          select 1 from public.team_members tm
          where tm.team_id = t.team_id and tm.user_id = t.user_id
        )
      group by t.user_id
      order by points desc;

  elsif p_period = 'current_month' then
    return query
      select e.user_id, sum(e.points)::bigint as points
      from public.fitness_score_events e
      where e.team_id = p_team_id
        and e.event_date >= date_trunc('month', current_date)::date
        and e.event_date < (date_trunc('month', current_date) + interval '1 month')::date
        and exists (
          select 1 from public.team_members tm
          where tm.team_id = e.team_id and tm.user_id = e.user_id
        )
      group by e.user_id
      order by points desc;

  else -- all_time
    return query
      select e.user_id, sum(e.points)::bigint as points
      from public.fitness_score_events e
      where e.team_id = p_team_id
        and exists (
          select 1 from public.team_members tm
          where tm.team_id = e.team_id and tm.user_id = e.user_id
        )
      group by e.user_id
      order by points desc;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- activity_feed.user_id was ON DELETE SET NULL, so a fully deleted account's
-- feed entries (e.g. "X ist dem Team beigetreten") survived as anonymous
-- "Jemand"-attributed rows instead of disappearing — visible ghost entries
-- in "Letzte Aktivitäten". Switch to ON DELETE CASCADE (the feed entry has
-- no value once the actor is gone) and clean up the two that already exist.
-- ---------------------------------------------------------------------------
delete from public.activity_feed where user_id is null;

alter table public.activity_feed
  drop constraint if exists activity_feed_user_id_fkey;

alter table public.activity_feed
  add constraint activity_feed_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;
