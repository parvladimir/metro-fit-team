-- ---------------------------------------------------------------------------
-- Lets a team admin start a fresh points/ranking count from a chosen instant
-- without deleting or rewriting any history. One nullable column on the
-- table that already holds this team's scoring config, and a read-time
-- filter in the one function that aggregates ranking — nothing else in the
-- scoring pipeline changes. A team that never sets this column is completely
-- unaffected (every added condition short-circuits to true).
-- ---------------------------------------------------------------------------
alter table public.team_ranking_rules add column if not exists points_reset_at timestamptz;

create or replace function public.get_team_ranking(p_team_id uuid, p_period text default 'current_week')
returns table (user_id uuid, points bigint)
language plpgsql
security invoker
stable
set search_path = public
as $$
declare
  v_reset_at timestamptz;
  v_reset_date date;
  v_week_start date;
begin
  if not public.is_team_member(p_team_id) then
    raise exception 'not_a_team_member' using errcode = '42501';
  end if;

  select points_reset_at into v_reset_at from public.team_ranking_rules where team_id = p_team_id;
  -- event_date has no time-of-day, so the cutoff can only ever be compared
  -- at day granularity — but it must be THIS team's local calendar day, not
  -- whatever timezone this Postgres session defaults to (confirmed UTC).
  -- Casting a Berlin-midnight instant straight to ::date under a UTC session
  -- would land on the PREVIOUS day and wrongly include up to ~24h of
  -- pre-cutoff activity; converting to Europe/Berlin wall-clock time first
  -- fixes that direction. A separate, narrower and safe-direction rounding
  -- residual remains for the pre-existing event_date column itself (also
  -- computed via an implicit, non-Berlin cast, elsewhere, at write time) —
  -- documented in the PR rather than fixed here, since correcting it would
  -- mean changing the trigger functions that write event_date, not just
  -- this read path.
  v_reset_date := (v_reset_at at time zone 'Europe/Berlin')::date;

  if p_period = 'current_week' or p_period = 'last_week' then
    v_week_start := case when p_period = 'current_week'
      then date_trunc('week', current_date)::date
      else (date_trunc('week', current_date) - interval '7 days')::date
    end;

    -- Reads fitness_score_events directly rather than the fitness_score_totals
    -- cache (which has no per-event date to filter by) so the reset cutoff
    -- can be applied here too. The totals cache is itself nothing but an
    -- incremental sum of these same events, so for a team with no cutoff
    -- set (v_reset_at is null) this produces the identical number, just
    -- computed live.
    return query
      select e.user_id, sum(e.points)::bigint as points
      from public.fitness_score_events e
      left join public.challenges c
        on e.event_type in ('challenge_completed', 'team_challenge_participation') and c.id = e.source_entity_id
      where e.team_id = p_team_id
        and e.event_date >= v_week_start and e.event_date < v_week_start + interval '7 days'
        and (v_reset_at is null or coalesce(c.starts_at, e.event_date) >= v_reset_date)
        and exists (
          select 1 from public.team_members tm
          where tm.team_id = e.team_id and tm.user_id = e.user_id
        )
      group by e.user_id
      order by points desc;

  elsif p_period = 'current_month' then
    return query
      select e.user_id, sum(e.points)::bigint as points
      from public.fitness_score_events e
      left join public.challenges c
        on e.event_type in ('challenge_completed', 'team_challenge_participation') and c.id = e.source_entity_id
      where e.team_id = p_team_id
        and e.event_date >= date_trunc('month', current_date)::date
        and e.event_date < (date_trunc('month', current_date) + interval '1 month')::date
        and (v_reset_at is null or coalesce(c.starts_at, e.event_date) >= v_reset_date)
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
      left join public.challenges c
        on e.event_type in ('challenge_completed', 'team_challenge_participation') and c.id = e.source_entity_id
      where e.team_id = p_team_id
        and (v_reset_at is null or coalesce(c.starts_at, e.event_date) >= v_reset_date)
        and exists (
          select 1 from public.team_members tm
          where tm.team_id = e.team_id and tm.user_id = e.user_id
        )
      group by e.user_id
      order by points desc;
  end if;
end;
$$;
