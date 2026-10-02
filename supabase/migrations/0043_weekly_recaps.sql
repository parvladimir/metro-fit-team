-- ---------------------------------------------------------------------------
-- personal_weekly_recaps / team_weekly_recaps — one idempotent row per
-- user/week and per team/week. No scheduled/cron infrastructure exists in
-- this project (no pg_cron, no vercel.json crons key, no scheduled GitHub
-- Action, no scheduling library) — per the product spec's own pre-approved
-- fallback, both tables are populated lazily: check-and-generate-if-missing
-- on the first request that needs them after the team-local (Europe/Berlin)
-- Monday-Sunday week has ended. The unique constraints + "on conflict do
-- update" below make generation idempotent by construction, mirroring
-- fitness_score_totals' unique(user_id, team_id, iso_year, iso_week)
-- (0006_scoring_ranking.sql). Both tables are written exclusively through
-- the SECURITY DEFINER functions below — same lockdown as
-- fitness_score_events/fitness_score_totals, no client insert/update RLS.
-- ---------------------------------------------------------------------------
create table public.personal_weekly_recaps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  iso_year int not null,
  iso_week int not null,
  week_start date not null,
  completed_workouts int not null default 0,
  minutes int not null default 0,
  points int not null default 0,
  weekly_goal int not null default 0,
  goal_achieved boolean not null default false,
  personal_record_title text,
  personal_record_detail text,
  streak_days int not null default 0,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, iso_year, iso_week)
);

create trigger personal_weekly_recaps_set_updated_at
  before update on public.personal_weekly_recaps
  for each row execute function public.set_updated_at();

create table public.team_weekly_recaps (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  iso_year int not null,
  iso_week int not null,
  week_start date not null,
  active_members int not null default 0,
  members_goal_reached int not null default 0,
  completed_workouts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, iso_year, iso_week)
);

create trigger team_weekly_recaps_set_updated_at
  before update on public.team_weekly_recaps
  for each row execute function public.set_updated_at();

-- Team-week aggregate for "STARKE WOCHE, TEAM!". Current, opted-in members
-- only — same privacy stance as get_team_mission_training_days. Takes a
-- timestamptz range (like 0041's get_team_workout_activity) because the TS
-- caller computes the exact Berlin week boundary (berlinPreviousWeekRange).
create or replace function public.get_team_week_summary(
  p_team_id uuid, p_range_start timestamptz, p_range_end timestamptz
)
returns table (completed_workouts int, active_members int, members_goal_reached int)
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
    with scoped as (
      select w.id, w.user_id
      from public.workouts w
      join public.team_members tm on tm.team_id = w.team_id and tm.user_id = w.user_id
      left join public.privacy_settings ps on ps.user_id = w.user_id
      where w.team_id = p_team_id
        and w.status = 'abgeschlossen'
        and w.finished_at >= p_range_start and w.finished_at < p_range_end
        and coalesce(ps.activity_feed_opt_in, true) = true
    ),
    per_member as (
      select user_id, count(*) as done from scoped group by user_id
    )
    select
      (select count(*) from scoped)::int,
      (select count(*) from per_member)::int,
      (select count(*) from per_member pm join public.profiles p on p.id = pm.user_id where pm.done >= coalesce(p.weekly_goal, 3))::int;
end;
$$;

revoke all on function public.get_team_week_summary(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_team_week_summary(uuid, timestamptz, timestamptz) to authenticated;

-- Idempotent upsert for the calling user's own recap. Numbers are computed in
-- TS (personal-record/streak detection reuses detectPersonalRecord/
-- computeStreakDays from src/lib/coach.ts — there is no SQL reimplementation)
-- and passed in. "is_new" (the standard xmax=0 on-conflict idiom) tells the
-- caller whether this call did the actual insert vs. a later correction
-- refreshing the row in place — the latter is what satisfies "a correction
-- updates the existing recap row, never a second one, never re-notifies."
create or replace function public.upsert_personal_weekly_recap(
  p_week_start date, p_team_id uuid,
  p_completed_workouts int, p_minutes int, p_points int, p_weekly_goal int, p_goal_achieved boolean,
  p_personal_record_title text, p_personal_record_detail text, p_streak_days int
)
returns table (id uuid, is_new boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_iso_year int := extract(isoyear from p_week_start)::int;
  v_iso_week int := extract(week from p_week_start)::int;
  v_id uuid;
  v_was_new boolean;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_team_id is not null and not public.is_team_member(p_team_id) then
    raise exception 'not_a_team_member' using errcode = '42501';
  end if;

  insert into public.personal_weekly_recaps (
    user_id, team_id, iso_year, iso_week, week_start,
    completed_workouts, minutes, points, weekly_goal, goal_achieved,
    personal_record_title, personal_record_detail, streak_days
  ) values (
    v_user_id, p_team_id, v_iso_year, v_iso_week, p_week_start,
    p_completed_workouts, p_minutes, p_points, p_weekly_goal, p_goal_achieved,
    p_personal_record_title, p_personal_record_detail, p_streak_days
  )
  on conflict (user_id, iso_year, iso_week) do update set
    team_id = excluded.team_id, completed_workouts = excluded.completed_workouts,
    minutes = excluded.minutes, points = excluded.points, weekly_goal = excluded.weekly_goal,
    goal_achieved = excluded.goal_achieved, personal_record_title = excluded.personal_record_title,
    personal_record_detail = excluded.personal_record_detail, streak_days = excluded.streak_days,
    updated_at = now()
  returning personal_weekly_recaps.id, (xmax = 0) into v_id, v_was_new;

  return query select v_id, v_was_new;
end;
$$;

revoke all on function public.upsert_personal_weekly_recap(date, uuid, int, int, int, int, boolean, text, text, int) from public, anon;
grant execute on function public.upsert_personal_weekly_recap(date, uuid, int, int, int, int, boolean, text, text, int) to authenticated;

create or replace function public.upsert_team_weekly_recap(
  p_team_id uuid, p_week_start date, p_completed_workouts int, p_active_members int, p_members_goal_reached int
)
returns table (id uuid, is_new boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_iso_year int := extract(isoyear from p_week_start)::int;
  v_iso_week int := extract(week from p_week_start)::int;
  v_id uuid;
  v_was_new boolean;
begin
  if not public.is_team_member(p_team_id) then
    raise exception 'not_a_team_member' using errcode = '42501';
  end if;

  insert into public.team_weekly_recaps (team_id, iso_year, iso_week, week_start, completed_workouts, active_members, members_goal_reached)
  values (p_team_id, v_iso_year, v_iso_week, p_week_start, p_completed_workouts, p_active_members, p_members_goal_reached)
  on conflict (team_id, iso_year, iso_week) do update set
    completed_workouts = excluded.completed_workouts, active_members = excluded.active_members,
    members_goal_reached = excluded.members_goal_reached, updated_at = now()
  returning team_weekly_recaps.id, (xmax = 0) into v_id, v_was_new;

  return query select v_id, v_was_new;
end;
$$;

revoke all on function public.upsert_team_weekly_recap(uuid, date, int, int, int) from public, anon;
grant execute on function public.upsert_team_weekly_recap(uuid, date, int, int, int) to authenticated;

-- Durable "the ready push was sent" marker, deliberately a separate call from
-- the upsert above so a transient push failure (web-push down, no
-- subscription yet) can be retried on a later visit instead of silently
-- losing the one-time notification opportunity forever.
create or replace function public.mark_weekly_recap_notified(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.personal_weekly_recaps set notified_at = now()
  where id = p_id and user_id = auth.uid();
$$;

revoke all on function public.mark_weekly_recap_notified(uuid) from public, anon;
grant execute on function public.mark_weekly_recap_notified(uuid) to authenticated;

-- RLS
alter table public.personal_weekly_recaps enable row level security;
alter table public.team_weekly_recaps enable row level security;

create policy "personal_weekly_recaps_select_own" on public.personal_weekly_recaps
  for select using (user_id = auth.uid());

create policy "team_weekly_recaps_select_member" on public.team_weekly_recaps
  for select using (public.is_team_member(team_id));
