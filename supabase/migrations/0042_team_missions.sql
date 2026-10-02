-- ---------------------------------------------------------------------------
-- team_missions — "Unsere Wochenmission": a cooperative, NON-scoring team
-- goal. Deliberately its own table, not a challenges reuse: challenge_
-- participants is shaped for one user's own individual progress (wrong shape
-- for a cooperative distinct-user×distinct-date count), challenge_type=
-- 'team' is operationally dead today (nothing ever creates a participant row
-- for it, and the herausforderungen list renders no interactive element for
-- it either), and a cancel action has zero existing template regardless of
-- table choice (challenges_admin_update/_delete exist in RLS but nothing in
-- the app ever calls them). Progress is computed live at read time (mirrors
-- getTeamChallenges' own live join), never a trigger-maintained column —
-- that is also what makes a departed/opted-out member's past contribution
-- stop counting automatically, with no separate recompute step.
-- ---------------------------------------------------------------------------
create table public.team_missions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  title text not null,
  target_days int not null check (target_days > 0),
  starts_at date not null,
  ends_at date not null check (ends_at >= starts_at),
  created_by uuid not null references public.profiles (id) on delete cascade,
  cancelled_at timestamptz,
  celebrated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index team_missions_team_id_idx on public.team_missions (team_id);

create trigger team_missions_set_updated_at
  before update on public.team_missions
  for each row execute function public.set_updated_at();

-- Freezes the mission's definition once created — an update may only ever
-- move cancelled_at/celebrated_at (both one-way, null -> timestamp) or the
-- updated_at trigger column. This is "no silent retroactive target changes"
-- enforced at the data layer, not just by the absence of an edit UI — same
-- spirit as guard_workout_update's immutable-field pattern
-- (0037_workout_pause_and_review_safety.sql).
create or replace function public.guard_team_mission_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.team_id is distinct from old.team_id
     or new.title is distinct from old.title
     or new.target_days is distinct from old.target_days
     or new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'mission_target_is_frozen' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger team_missions_guard_update
  before update on public.team_missions
  for each row execute function public.guard_team_mission_update();

-- Live training-days progress for a date range: a current, opted-in member
-- with >=1 completed workout on one Berlin calendar date contributes one
-- training day; extra workouts the same day don't add more; a different
-- member training that day contributes another. Converts to the team's
-- Berlin calendar day explicitly (at time zone 'Europe/Berlin') rather than
-- a plain finished_at::date cast, which would resolve under this Postgres
-- session's UTC timezone and misfile activity near local midnight — the
-- same boundary-precision bar the points_reset_at and "Heute im Team" work
-- already held elsewhere in this codebase. Reuses the partial index from
-- 0041 (workouts_team_status_finished_idx). Privacy/membership checks match
-- every other existing read of activity_feed_opt_in exactly: a left join
-- with coalesce(..., true), so a missing settings row means opted-in, same
-- as everywhere else this flag is read.
create or replace function public.get_team_mission_training_days(
  p_team_id uuid, p_start_date date, p_end_date date
)
returns int
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.is_team_member(p_team_id) then
    raise exception 'not_a_team_member' using errcode = '42501';
  end if;

  select count(distinct (w.user_id, (w.finished_at at time zone 'Europe/Berlin')::date))
  into v_count
  from public.workouts w
  join public.team_members tm on tm.team_id = w.team_id and tm.user_id = w.user_id
  left join public.privacy_settings ps on ps.user_id = w.user_id
  where w.team_id = p_team_id
    and w.status = 'abgeschlossen'
    and (w.finished_at at time zone 'Europe/Berlin')::date between p_start_date and p_end_date
    and coalesce(ps.activity_feed_opt_in, true) = true;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.get_team_mission_training_days(uuid, date, date) from public, anon;
grant execute on function public.get_team_mission_training_days(uuid, date, date) to authenticated;

-- Atomically claims the once-only completion write. The `where celebrated_at
-- is null` guard makes this race-safe under concurrent callers (two members
-- opening the app at the same moment) — only one UPDATE ever affects a row.
-- This function only performs the one-time WRITE; deciding who gets to SEE
-- the celebration is a read-time concern in the app (checking how recent
-- celebrated_at is), not tied to which caller's request happened to win this
-- claim. No scoring call anywhere in this path — mission completion can
-- never produce a fitness_score_events row.
create or replace function public.maybe_celebrate_mission(p_mission_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mission public.team_missions%rowtype;
  v_progress int;
  v_claimed boolean := false;
begin
  select * into v_mission from public.team_missions where id = p_mission_id;
  if not found or v_mission.cancelled_at is not null or v_mission.celebrated_at is not null then
    return false;
  end if;
  if not public.is_team_member(v_mission.team_id) then
    raise exception 'not_a_team_member' using errcode = '42501';
  end if;

  v_progress := public.get_team_mission_training_days(v_mission.team_id, v_mission.starts_at, v_mission.ends_at);
  if v_progress < v_mission.target_days then
    return false;
  end if;

  update public.team_missions set celebrated_at = now()
  where id = p_mission_id and celebrated_at is null
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

revoke all on function public.maybe_celebrate_mission(uuid) from public, anon;
grant execute on function public.maybe_celebrate_mission(uuid) to authenticated;

-- RLS — mirrors challenges' shape; no delete policy, cancellation is
-- cancelled_at only (never a row delete).
alter table public.team_missions enable row level security;

create policy "team_missions_select_member" on public.team_missions
  for select using (public.is_team_member(team_id));

create policy "team_missions_admin_insert" on public.team_missions
  for insert with check (public.is_team_admin(team_id) and created_by = auth.uid());

create policy "team_missions_admin_update" on public.team_missions
  for update using (public.is_team_admin(team_id));
