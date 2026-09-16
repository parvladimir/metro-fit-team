-- ---------------------------------------------------------------------------
-- get_team_ranking — canonical ranking query, shared by web + future native
-- clients via a single RPC call. Relies on the caller's own RLS-scoped
-- session (SECURITY INVOKER), so a user only ever sees teams they belong to.
-- p_period: 'current_week' | 'last_week' | 'current_month' | 'all_time'
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
      group by t.user_id
      order by points desc;

  elsif p_period = 'last_week' then
    v_iso_year := extract(isoyear from current_date - interval '7 days')::int;
    v_iso_week := extract(week from current_date - interval '7 days')::int;
    return query
      select t.user_id, sum(t.points)::bigint as points
      from public.fitness_score_totals t
      where t.team_id = p_team_id and t.iso_year = v_iso_year and t.iso_week = v_iso_week
      group by t.user_id
      order by points desc;

  elsif p_period = 'current_month' then
    return query
      select e.user_id, sum(e.points)::bigint as points
      from public.fitness_score_events e
      where e.team_id = p_team_id
        and e.event_date >= date_trunc('month', current_date)::date
        and e.event_date < (date_trunc('month', current_date) + interval '1 month')::date
      group by e.user_id
      order by points desc;

  else -- all_time
    return query
      select e.user_id, sum(e.points)::bigint as points
      from public.fitness_score_events e
      where e.team_id = p_team_id
      group by e.user_id
      order by points desc;
  end if;
end;
$$;

grant execute on function public.get_team_ranking(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_weekly_comparison — this week vs. last week, for the "Wochenvergleich"
-- screen. Returns one row per metric.
-- ---------------------------------------------------------------------------
create or replace function public.get_weekly_comparison(p_user_id uuid)
returns table (
  metric text,
  current_value numeric,
  previous_value numeric
)
language plpgsql
security invoker
stable
set search_path = public
as $$
declare
  v_week_start date := date_trunc('week', current_date)::date;
  v_prev_week_start date := v_week_start - interval '7 days';
begin
  if p_user_id <> auth.uid() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return query
  select 'workouts'::text,
    (select count(*) from public.workouts where user_id = p_user_id and status = 'abgeschlossen'
      and finished_at >= v_week_start and finished_at < v_week_start + interval '7 days')::numeric,
    (select count(*) from public.workouts where user_id = p_user_id and status = 'abgeschlossen'
      and finished_at >= v_prev_week_start and finished_at < v_week_start)::numeric
  union all
  select 'minutes'::text,
    (select coalesce(sum(duration_seconds), 0) / 60.0 from public.workouts where user_id = p_user_id and status = 'abgeschlossen'
      and finished_at >= v_week_start and finished_at < v_week_start + interval '7 days'),
    (select coalesce(sum(duration_seconds), 0) / 60.0 from public.workouts where user_id = p_user_id and status = 'abgeschlossen'
      and finished_at >= v_prev_week_start and finished_at < v_week_start)
  union all
  select 'points'::text,
    (select coalesce(sum(points), 0) from public.fitness_score_events where user_id = p_user_id
      and event_date >= v_week_start and event_date < v_week_start + interval '7 days'),
    (select coalesce(sum(points), 0) from public.fitness_score_events where user_id = p_user_id
      and event_date >= v_prev_week_start and event_date < v_week_start);
end;
$$;

grant execute on function public.get_weekly_comparison(uuid) to authenticated;
