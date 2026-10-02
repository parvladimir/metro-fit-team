-- ---------------------------------------------------------------------------
-- team_duels — "Freundschaftsduell": an OPTIONAL, private, seven-day friendly
-- challenge between exactly two members of one team. Each of the two sets
-- the same personal-pace goal ("X training days in these 7 days"); there is
-- no head-to-head scoring, no points, no ranking effect and nothing is
-- published to the team — the two participants alone see their own and the
-- other's COUNT of training days (never workout contents).
--
-- Design points, all enforced here rather than in the UI:
--   * A duel exists only after the invitee explicitly accepts: only the
--     invitee can accept, a pending invitation expires on its own, and it can
--     never start retroactively (start date strictly in the future when
--     proposed, and an invitation is dead from the start date on).
--   * One open duel per person per team (pending-and-live or accepted-and-
--     not-yet-finished). The check runs under per-person advisory locks, so
--     two concurrent proposals can never both win.
--   * Terms (target, dates, participants, expiry) are frozen once created and
--     status can only move forward — no silent retroactive changes.
--   * Withdrawing never needs a reason and nothing records one.
--   * Either participant leaving the team makes the duel invisible to the
--     other and unblocks them; re-joining restores it. Both rows cascade away
--     with either account, so account deletion needs no special handling.
--   * Progress counts, per participant, the distinct Berlin calendar dates in
--     the window with at least one completed workout, capped at the target
--     (extra workouts on one date, or beyond the goal, add nothing). It does
--     NOT apply the activity_feed_opt_in filter that team-wide features use:
--     accepting a duel is an explicit, per-duel, disclosed consent to share
--     exactly this count with exactly one person, and "I accepted but my
--     workouts do not count" would be a confusing failure. Counts only.
-- Berlin calendar dates are always computed with `at time zone
-- 'Europe/Berlin'`, never a plain ::date cast (this session runs in UTC), and
-- "now" uses clock_timestamp() so a decision made inside a long transaction
-- still sees the real current time.
-- ---------------------------------------------------------------------------
create table public.team_duels (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  inviter_id uuid not null references public.profiles (id) on delete cascade,
  invitee_id uuid not null references public.profiles (id) on delete cascade,
  target_days smallint not null check (target_days between 1 and 7),
  starts_on date not null,
  ends_on date not null,
  expires_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  responded_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_duels_distinct_participants check (inviter_id <> invitee_id),
  constraint team_duels_seven_days check (ends_on = starts_on + 6),
  constraint team_duels_cancelled_by_matches_status check ((status = 'cancelled') = (cancelled_by is not null))
);

create index team_duels_inviter_idx on public.team_duels (inviter_id);
create index team_duels_invitee_idx on public.team_duels (invitee_id);
create index team_duels_team_open_idx on public.team_duels (team_id) where status in ('pending', 'accepted');

create trigger team_duels_set_updated_at
  before update on public.team_duels
  for each row execute function public.set_updated_at();

-- Freezes the duel's terms and makes status a one-way street. "Finished" is
-- deliberately not a stored status: it is derived (accepted + ends_on in the
-- past), so nothing ever has to run at midnight to move a duel along.
-- No role bypass, same as guard_team_mission_update (0042).
create or replace function public.guard_team_duel_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.team_id is distinct from old.team_id
     or new.inviter_id is distinct from old.inviter_id
     or new.invitee_id is distinct from old.invitee_id
     or new.target_days is distinct from old.target_days
     or new.starts_on is distinct from old.starts_on
     or new.ends_on is distinct from old.ends_on
     or new.expires_at is distinct from old.expires_at
     or new.created_at is distinct from old.created_at then
    raise exception 'duel_terms_are_frozen' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'pending' and new.status in ('accepted', 'declined', 'cancelled', 'expired'))
      or (old.status = 'accepted' and new.status = 'cancelled')
    ) then
      raise exception 'invalid_duel_transition' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger team_duels_guard_update
  before update on public.team_duels
  for each row execute function public.guard_team_duel_update();

-- ---------------------------------------------------------------------------
-- Visibility: ONLY the two participants, and only while both are still current
-- members of the duel's team. A team admin, any other member, a former
-- member and anonymous callers all see nothing — a duel is not team data.
-- ---------------------------------------------------------------------------
create or replace function public.is_duel_participant(p_team_id uuid, p_inviter_id uuid, p_invitee_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(auth.uid() in (p_inviter_id, p_invitee_id), false)
     and exists (select 1 from public.team_members where team_id = p_team_id and user_id = p_inviter_id)
     and exists (select 1 from public.team_members where team_id = p_team_id and user_id = p_invitee_id);
$$;

grant execute on function public.is_duel_participant(uuid, uuid, uuid) to authenticated;

alter table public.team_duels enable row level security;

-- No insert/update/delete policy on purpose: every write goes through the
-- SECURITY DEFINER functions below, which enforce the rules.
create policy "team_duels_select_participant" on public.team_duels
  for select using (public.is_duel_participant(team_id, inviter_id, invitee_id));

-- ---------------------------------------------------------------------------
-- Internal: does this user already have an open duel in this team? "Open" is
-- a pending invitation that is still live (neither expired nor past its start
-- date) or an accepted duel that has not finished, in either case with the
-- other person still a team member. NOT callable by clients — it takes an
-- arbitrary user id and would otherwise be an oracle for "is X busy".
-- ---------------------------------------------------------------------------
create or replace function public.has_open_duel(p_team_id uuid, p_user_id uuid, p_today date)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.team_duels d
    where d.team_id = p_team_id
      and p_user_id in (d.inviter_id, d.invitee_id)
      and (
        (d.status = 'pending' and d.expires_at > clock_timestamp() and d.starts_on > p_today)
        or (d.status = 'accepted' and d.ends_on >= p_today)
      )
      and exists (
        select 1 from public.team_members tm
        where tm.team_id = d.team_id
          and tm.user_id = case when d.inviter_id = p_user_id then d.invitee_id else d.inviter_id end
      )
  );
$$;

revoke all on function public.has_open_duel(uuid, uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- propose_team_duel — send an invitation. Returns the duel and whether this
-- call created it: an identical retry (double tap, flaky network) returns the
-- existing pending invitation with is_new = false instead of a second one, so
-- the caller only notifies once.
--
-- The two participants' advisory locks are taken, in ascending-uuid order so
-- two crossing proposals cannot deadlock, BEFORE any duel row is read: that is
-- what makes "A invites B" racing "C invites B" produce exactly one winner.
-- "Invitee not in this team" and "invitee already busy" raise the same
-- neutral error, so a caller learns nothing about someone else's state.
-- ---------------------------------------------------------------------------
create or replace function public.propose_team_duel(
  p_team_id uuid, p_invitee_id uuid, p_target_days int, p_starts_on date
)
returns table (duel_id uuid, is_new boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_today date := (clock_timestamp() at time zone 'Europe/Berlin')::date;
  v_first uuid;
  v_second uuid;
  v_existing uuid;
  v_new uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_team_member(p_team_id) then
    raise exception 'not_a_team_member' using errcode = '42501';
  end if;
  if p_invitee_id is null or p_invitee_id = v_me then
    raise exception 'invalid_invitee' using errcode = '22023';
  end if;
  if p_target_days is null or p_target_days < 1 or p_target_days > 7 then
    raise exception 'invalid_target_days' using errcode = '22023';
  end if;
  -- Strictly in the future (never retroactive, never "already running"), and
  -- not so far out that an invitation sits around for weeks.
  if p_starts_on is null or p_starts_on <= v_today or p_starts_on > v_today + 14 then
    raise exception 'invalid_start_date' using errcode = '22023';
  end if;

  if not exists (select 1 from public.team_members where team_id = p_team_id and user_id = p_invitee_id) then
    raise exception 'invitee_unavailable';
  end if;

  v_first := least(v_me, p_invitee_id);
  v_second := greatest(v_me, p_invitee_id);
  perform pg_advisory_xact_lock(hashtextextended('team_duel:' || p_team_id::text || ':' || v_first::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('team_duel:' || p_team_id::text || ':' || v_second::text, 0));

  -- Dead invitations of either person stop blocking them.
  update public.team_duels
     set status = 'expired'
   where team_id = p_team_id
     and status = 'pending'
     and (expires_at <= clock_timestamp() or starts_on <= v_today)
     and (inviter_id in (v_me, p_invitee_id) or invitee_id in (v_me, p_invitee_id));

  select d.id into v_existing
  from public.team_duels d
  where d.team_id = p_team_id
    and d.inviter_id = v_me
    and d.invitee_id = p_invitee_id
    and d.status = 'pending'
    and d.target_days = p_target_days
    and d.starts_on = p_starts_on
    and d.expires_at > clock_timestamp();
  if v_existing is not null then
    duel_id := v_existing;
    is_new := false;
    return next;
    return;
  end if;

  if public.has_open_duel(p_team_id, v_me, v_today) then
    raise exception 'already_in_duel';
  end if;
  if public.has_open_duel(p_team_id, p_invitee_id, v_today) then
    raise exception 'invitee_unavailable';
  end if;

  insert into public.team_duels (team_id, inviter_id, invitee_id, target_days, starts_on, ends_on, expires_at)
  values (
    p_team_id, v_me, p_invitee_id, p_target_days, p_starts_on, p_starts_on + 6,
    -- Three days to answer, but never later than the start of the duel itself.
    least(clock_timestamp() + interval '3 days', p_starts_on::timestamp at time zone 'Europe/Berlin')
  )
  returning id into v_new;

  duel_id := v_new;
  is_new := true;
  return next;
end;
$$;

revoke all on function public.propose_team_duel(uuid, uuid, int, date) from public, anon;
grant execute on function public.propose_team_duel(uuid, uuid, int, date) to authenticated;

-- ---------------------------------------------------------------------------
-- respond_team_duel — the invitee accepts or declines. Only the invitee: any
-- other caller (the inviter, another member, an outsider, a former member)
-- gets the same duel_not_found as for a duel that does not exist. Never
-- raises for a duel that is no longer pending — it reports the current status
-- (changed = false), so retries and double taps are harmless. An invitation
-- found stale (expired, or already past its start date) is persisted as
-- 'expired' and RETURNED rather than raised, so the write survives.
-- ---------------------------------------------------------------------------
create or replace function public.respond_team_duel(p_duel_id uuid, p_accept boolean)
returns table (duel_status text, changed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_today date := (clock_timestamp() at time zone 'Europe/Berlin')::date;
  v_duel public.team_duels%rowtype;
  v_new_status text;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_accept is null then
    raise exception 'invalid_response' using errcode = '22023';
  end if;

  select * into v_duel from public.team_duels where id = p_duel_id for update;
  if not found
     or v_duel.invitee_id <> v_me
     or not exists (select 1 from public.team_members where team_id = v_duel.team_id and user_id = v_duel.invitee_id)
     or not exists (select 1 from public.team_members where team_id = v_duel.team_id and user_id = v_duel.inviter_id) then
    raise exception 'duel_not_found' using errcode = 'P0002';
  end if;

  if v_duel.status <> 'pending' then
    return query select v_duel.status, false;
    return;
  end if;

  if v_duel.expires_at <= clock_timestamp() or v_duel.starts_on <= v_today then
    update public.team_duels set status = 'expired' where id = v_duel.id;
    return query select 'expired'::text, true;
    return;
  end if;

  v_new_status := case when p_accept then 'accepted' else 'declined' end;
  update public.team_duels
     set status = v_new_status, responded_at = clock_timestamp()
   where id = v_duel.id;
  return query select v_new_status, true;
end;
$$;

revoke all on function public.respond_team_duel(uuid, boolean) from public, anon;
grant execute on function public.respond_team_duel(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- cancel_team_duel — either participant ends a duel, no reason asked or
-- stored. A pending invitation cancelled by the invitee is simply a decline;
-- by the inviter, a withdrawal. A duel that has already ended in any way is a
-- no-op (the current status is returned), including a finished one — its
-- result cannot be rewritten after the fact.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_team_duel(p_duel_id uuid)
returns table (duel_status text, changed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_today date := (clock_timestamp() at time zone 'Europe/Berlin')::date;
  v_duel public.team_duels%rowtype;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_duel from public.team_duels where id = p_duel_id for update;
  if not found
     or v_me not in (v_duel.inviter_id, v_duel.invitee_id)
     or not exists (select 1 from public.team_members where team_id = v_duel.team_id and user_id = v_duel.invitee_id)
     or not exists (select 1 from public.team_members where team_id = v_duel.team_id and user_id = v_duel.inviter_id) then
    raise exception 'duel_not_found' using errcode = 'P0002';
  end if;

  if v_duel.status in ('declined', 'cancelled', 'expired') then
    return query select v_duel.status, false;
    return;
  end if;

  if v_duel.status = 'pending' then
    if v_duel.expires_at <= clock_timestamp() or v_duel.starts_on <= v_today then
      update public.team_duels set status = 'expired' where id = v_duel.id;
      return query select 'expired'::text, true;
    elsif v_me = v_duel.invitee_id then
      update public.team_duels set status = 'declined', responded_at = clock_timestamp() where id = v_duel.id;
      return query select 'declined'::text, true;
    else
      update public.team_duels set status = 'cancelled', cancelled_by = v_me where id = v_duel.id;
      return query select 'cancelled'::text, true;
    end if;
    return;
  end if;

  -- accepted
  if v_duel.ends_on < v_today then
    return query select v_duel.status, false;
    return;
  end if;
  update public.team_duels set status = 'cancelled', cancelled_by = v_me where id = v_duel.id;
  return query select 'cancelled'::text, true;
end;
$$;

revoke all on function public.cancel_team_duel(uuid) from public, anon;
grant execute on function public.cancel_team_duel(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_duel_progress — the two participants' training-day counts for an
-- ACCEPTED duel. Participant-only; for anyone else, a duel that is not
-- accepted, or one whose participant left the team, it returns no rows (not
-- an error — no oracle for whether the duel exists).
--
-- The window is the instant range [start-of-starts_on, start-of-day-after-
-- ends_on) in Berlin time, so a 23h or 25h daylight-saving day still spans
-- exactly its own midnight-to-midnight and a workout at 23:30 or 00:30 lands
-- on the right side. Each participant gets the number of distinct Berlin
-- dates with a completed workout, capped at the target; both participants are
-- always returned (0 when none).
-- ---------------------------------------------------------------------------
create or replace function public.get_duel_progress(p_duel_id uuid)
returns table (participant_id uuid, counted_days int)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_duel public.team_duels%rowtype;
  v_window_start timestamptz;
  v_window_end timestamptz;
begin
  select * into v_duel from public.team_duels where id = p_duel_id;
  if not found
     or v_duel.status <> 'accepted'
     or not public.is_duel_participant(v_duel.team_id, v_duel.inviter_id, v_duel.invitee_id) then
    return;
  end if;

  v_window_start := v_duel.starts_on::timestamp at time zone 'Europe/Berlin';
  v_window_end := (v_duel.ends_on + 1)::timestamp at time zone 'Europe/Berlin';

  return query
    select p.pid,
           least(coalesce(c.days, 0), v_duel.target_days::int)::int
    from (values (v_duel.inviter_id), (v_duel.invitee_id)) as p(pid)
    left join lateral (
      select count(distinct (w.finished_at at time zone 'Europe/Berlin')::date)::int as days
      from public.workouts w
      where w.user_id = p.pid
        and w.team_id = v_duel.team_id
        and w.status = 'abgeschlossen'
        and w.finished_at >= v_window_start
        and w.finished_at < v_window_end
    ) c on true;
end;
$$;

revoke all on function public.get_duel_progress(uuid) from public, anon;
grant execute on function public.get_duel_progress(uuid) to authenticated;
