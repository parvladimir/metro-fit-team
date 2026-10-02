-- ---------------------------------------------------------------------------
-- "Wer ist dabei?" — a lightweight joint-training invitation shown as ONE
-- structured card in the team chat: a title, a time, optionally a training
-- type, a linked shared template, a manually typed meeting place and a short
-- note, plus per-member "Dabei" / "Vielleicht" answers.
--
-- It is deliberately NOT a workout and NOT an attendance system: an answer
-- creates no workout, no points, no feed item and no notification row, and
-- nothing here ever touches location (the place is free text the organizer
-- types; there is no geolocation anywhere). Answers are non-binding and can be
-- changed or withdrawn at any time until the training starts.
--
-- Same chat-card pattern as plan shares (0036): the chat message stays a plain
-- 'text' message with a human-readable fallback sentence, and everything
-- structured lives in new side tables, written only by SECURITY DEFINER
-- functions (no client write policies). Three realtime gaps in that precedent
-- are closed here, because an invitation card is edited and answered
-- constantly, unlike a published snapshot:
--   1. both tables are added to the realtime publication (with full replica
--      identity), so other members' answers and edits arrive live;
--   2. the message is INSERTed with its metadata already set — plan shares
--      INSERT then UPDATE, so a realtime client briefly sees a share message
--      without its hint and renders a plain bubble;
--   3. removing an answer is a DELETE, whose realtime payload can be reduced
--      to primary keys under RLS and so cannot be routed to a card; every
--      real change therefore also bumps invites.rsvp_version, an UPDATE that
--      carries the invite's own id and team_id.
-- ---------------------------------------------------------------------------
create table public.training_invites (
  -- Client-supplied so a double tap / flaky retry of "publish" is idempotent.
  id uuid primary key,
  message_id uuid not null unique references public.messages (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  organizer_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  starts_at timestamptz not null,
  activity_type text check (activity_type in (
    'krafttraining', 'laufen', 'gehen', 'radfahren', 'schwimmen', 'cardio', 'fussball', 'fitnesskurs', 'sonstiges'
  )),
  place text check (place is null or char_length(place) between 1 and 80),
  note text check (note is null or char_length(note) between 1 and 200),
  -- Provenance only: if the share is deleted the invitation simply loses the
  -- link. Viewing/importing the template stays under plan_shares' own rules
  -- (members only, refused once withdrawn).
  plan_share_id uuid references public.plan_shares (id) on delete set null,
  rsvp_version integer not null default 0,
  cancelled_at timestamptz,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, team_id)
);

create index training_invites_team_starts_idx on public.training_invites (team_id, starts_at);
create index training_invites_organizer_idx on public.training_invites (organizer_id);

create table public.training_invite_rsvps (
  invite_id uuid not null,
  team_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null check (status in ('going', 'maybe')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (invite_id, user_id),
  -- Composite: an answer can never name a team different from its invitation's.
  foreign key (invite_id, team_id) references public.training_invites (id, team_id) on delete cascade
);

create index training_invite_rsvps_user_idx on public.training_invite_rsvps (user_id);

create trigger training_invite_rsvps_set_updated_at
  before update on public.training_invite_rsvps
  for each row execute function public.set_updated_at();

-- What may never change after publishing (the chat message it belongs to, the
-- team, the organizer), and cancellation is final. Title, time, place, note,
-- type and the template link are editable — but only through
-- update_training_invite, which is the one function with a client path.
create or replace function public.guard_training_invite_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.message_id is distinct from old.message_id
     or new.team_id is distinct from old.team_id
     or new.organizer_id is distinct from old.organizer_id
     or new.created_at is distinct from old.created_at then
    raise exception 'invite_identity_is_frozen' using errcode = '42501';
  end if;
  if old.cancelled_at is not null and new.cancelled_at is distinct from old.cancelled_at then
    raise exception 'invite_cancellation_is_final' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger training_invites_guard_update
  before update on public.training_invites
  for each row execute function public.guard_training_invite_update();

-- ---------------------------------------------------------------------------
-- RLS: read-only for clients. An invitation is visible to current members of
-- its team; an answer additionally only while its author is still a member, so
-- a member who left does not linger in the participant list (and returns,
-- with their answer, if they rejoin).
-- ---------------------------------------------------------------------------
create or replace function public.team_has_member(p_team_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.team_members where team_id = p_team_id and user_id = p_user_id);
$$;

grant execute on function public.team_has_member(uuid, uuid) to authenticated;

alter table public.training_invites enable row level security;
alter table public.training_invite_rsvps enable row level security;

create policy "training_invites_select_team" on public.training_invites
  for select using (public.is_team_member(team_id));

create policy "training_invite_rsvps_select_team" on public.training_invite_rsvps
  for select using (public.is_team_member(team_id) and public.team_has_member(team_id, user_id));

-- Realtime: full replica identity so UPDATE/DELETE payloads carry the whole
-- old row, and publication membership (idempotent, like 0008/0031).
alter table public.training_invites replica identity full;
alter table public.training_invite_rsvps replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.training_invites;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.training_invite_rsvps;
exception when duplicate_object then null;
end $$;

-- plan_shares: the chat client already subscribes to its UPDATEs (so a
-- withdrawn share disappears live for everyone), but 0036 never added the table
-- to the publication. Realtime rejects a WHOLE channel when any one binding names
-- an unpublished table ("Unable to subscribe to changes with given parameters"),
-- and ChatRoom puts all of its bindings — messages, reactions, mentions and now
-- these invitation cards — on one channel. Left as is, none of them would ever
-- arrive live. Idempotent, like the two statements above.
do $$
begin
  alter publication supabase_realtime add table public.plan_shares;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Shared validation: trims, bounds and normalizes the free-text fields so
-- publish and update agree exactly. Empty text becomes NULL. Raises a
-- specific, translatable error per field.
-- ---------------------------------------------------------------------------
create or replace function public.normalize_training_invite_fields(
  p_title text, p_starts_at timestamptz, p_activity_type text, p_place text, p_note text, p_plan_share_id uuid, p_team_id uuid,
  out v_title text, out v_place text, out v_note text
)
returns record
language plpgsql
security definer
set search_path = public
as $$
begin
  v_title := btrim(coalesce(p_title, ''));
  if char_length(v_title) < 1 or char_length(v_title) > 80 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;
  v_place := nullif(btrim(coalesce(p_place, '')), '');
  if v_place is not null and char_length(v_place) > 80 then
    raise exception 'invalid_place' using errcode = '22023';
  end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 200 then
    raise exception 'invalid_note' using errcode = '22023';
  end if;
  if p_activity_type is not null and p_activity_type not in (
    'krafttraining', 'laufen', 'gehen', 'radfahren', 'schwimmen', 'cardio', 'fussball', 'fitnesskurs', 'sonstiges'
  ) then
    raise exception 'invalid_activity_type' using errcode = '22023';
  end if;
  -- In the future, and not so far ahead that it is a placeholder.
  if p_starts_at is null or p_starts_at <= clock_timestamp() or p_starts_at > clock_timestamp() + interval '90 days' then
    raise exception 'invalid_start_time' using errcode = '22023';
  end if;
  -- A linked template must be a live share of THIS team — never a template,
  -- plan day or workout id, and never another team's or a withdrawn share.
  if p_plan_share_id is not null and not exists (
    select 1 from public.plan_shares s
    where s.id = p_plan_share_id and s.team_id = p_team_id and s.withdrawn_at is null
  ) then
    raise exception 'invalid_plan_share' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.normalize_training_invite_fields(text, timestamptz, text, text, text, uuid, uuid) from public, anon, authenticated;

create or replace function public.training_invite_message_text(p_title text, p_starts_at timestamptz)
returns text
language sql
stable
set search_path = public
as $$
  select 'Gemeinsames Training: ' || p_title || ' · '
         || to_char(p_starts_at at time zone 'Europe/Berlin', 'DD.MM.YYYY, HH24:MI') || ' Uhr';
$$;

revoke all on function public.training_invite_message_text(text, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- publish_training_invite — creates the chat message, the invitation and the
-- organizer's own "Dabei" in one transaction. Idempotent on p_invite_id: a
-- retry by the same organizer in the same team returns the existing card
-- (is_new = false) so the caller notifies only once; the same id used by
-- anyone else is simply refused. The message carries its metadata from the
-- first INSERT.
-- ---------------------------------------------------------------------------
create or replace function public.publish_training_invite(
  p_invite_id uuid, p_team_id uuid, p_title text, p_starts_at timestamptz,
  p_activity_type text default null, p_place text default null, p_note text default null, p_plan_share_id uuid default null
)
returns table (out_message_id uuid, out_invite_id uuid, is_new boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_title text;
  v_place text;
  v_note text;
  v_existing public.training_invites%rowtype;
  v_message_id uuid := gen_random_uuid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_invite_id is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if not public.is_team_member(p_team_id) then
    raise exception 'not_a_team_member' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('training_invite:' || p_invite_id::text, 0));
  select * into v_existing from public.training_invites where id = p_invite_id;
  if found then
    if v_existing.organizer_id = v_me and v_existing.team_id = p_team_id then
      return query select v_existing.message_id, v_existing.id, false;
      return;
    end if;
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  select n.v_title, n.v_place, n.v_note
    into v_title, v_place, v_note
    from public.normalize_training_invite_fields(p_title, p_starts_at, p_activity_type, p_place, p_note, p_plan_share_id, p_team_id) n;

  insert into public.messages (id, team_id, user_id, content, message_type, metadata)
  values (
    v_message_id, p_team_id, v_me, public.training_invite_message_text(v_title, p_starts_at), 'text',
    jsonb_build_object('training_invite_id', p_invite_id)
  );

  insert into public.training_invites (id, message_id, team_id, organizer_id, title, starts_at, activity_type, place, note, plan_share_id)
  values (p_invite_id, v_message_id, p_team_id, v_me, v_title, p_starts_at, p_activity_type, v_place, v_note, p_plan_share_id);

  insert into public.training_invite_rsvps (invite_id, team_id, user_id, status)
  values (p_invite_id, p_team_id, v_me, 'going');

  return query select v_message_id, p_invite_id, true;
end;
$$;

revoke all on function public.publish_training_invite(uuid, uuid, text, timestamptz, text, text, text, uuid) from public, anon;
grant execute on function public.publish_training_invite(uuid, uuid, text, timestamptz, text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- update_training_invite — organizer only, while the invitation is open and
-- has not started. Returns what the caller needs to decide about
-- notifications: `changed` (anything differed), `substantial` (the time or the
-- place changed — the only edits worth a push). An identical re-submit (double
-- tap) writes nothing and reports (false, false), so participants are never
-- notified twice. Existing answers are kept. Rewrites the message's fallback
-- sentence without marking the message "edited".
-- ---------------------------------------------------------------------------
create or replace function public.update_training_invite(
  p_invite_id uuid, p_title text, p_starts_at timestamptz,
  p_activity_type text default null, p_place text default null, p_note text default null, p_plan_share_id uuid default null
)
returns table (changed boolean, substantial boolean, out_message_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_inv public.training_invites%rowtype;
  v_title text;
  v_place text;
  v_note text;
  v_substantial boolean;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_inv from public.training_invites where id = p_invite_id for update;
  if not found or v_inv.organizer_id <> v_me or not public.is_team_member(v_inv.team_id) then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;
  if v_inv.cancelled_at is not null
     or exists (select 1 from public.messages m where m.id = v_inv.message_id and m.deleted_at is not null) then
    raise exception 'invite_closed' using errcode = 'P0001';
  end if;
  if v_inv.starts_at <= clock_timestamp() then
    raise exception 'invite_started' using errcode = 'P0001';
  end if;

  select n.v_title, n.v_place, n.v_note
    into v_title, v_place, v_note
    from public.normalize_training_invite_fields(p_title, p_starts_at, p_activity_type, p_place, p_note, p_plan_share_id, v_inv.team_id) n;

  if v_title = v_inv.title
     and p_starts_at = v_inv.starts_at
     and p_activity_type is not distinct from v_inv.activity_type
     and v_place is not distinct from v_inv.place
     and v_note is not distinct from v_inv.note
     and p_plan_share_id is not distinct from v_inv.plan_share_id then
    return query select false, false, v_inv.message_id;
    return;
  end if;

  v_substantial := p_starts_at is distinct from v_inv.starts_at or v_place is distinct from v_inv.place;

  update public.training_invites
     set title = v_title, starts_at = p_starts_at, activity_type = p_activity_type,
         place = v_place, note = v_note, plan_share_id = p_plan_share_id, edited_at = clock_timestamp()
   where id = p_invite_id;

  update public.messages
     set content = public.training_invite_message_text(v_title, p_starts_at)
   where id = v_inv.message_id;

  return query select true, v_substantial, v_inv.message_id;
end;
$$;

revoke all on function public.update_training_invite(uuid, text, timestamptz, text, text, text, uuid) from public, anon;
grant execute on function public.update_training_invite(uuid, text, timestamptz, text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- cancel_training_invite — organizer only, idempotent. `was_upcoming` tells
-- the caller whether anyone could still have been planning to go (so a
-- cancellation of something that already started is not pushed).
-- ---------------------------------------------------------------------------
create or replace function public.cancel_training_invite(p_invite_id uuid)
returns table (newly_cancelled boolean, was_upcoming boolean, out_message_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_inv public.training_invites%rowtype;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_inv from public.training_invites where id = p_invite_id for update;
  if not found or v_inv.organizer_id <> v_me or not public.is_team_member(v_inv.team_id) then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;

  if v_inv.cancelled_at is not null then
    return query select false, false, v_inv.message_id;
    return;
  end if;

  update public.training_invites set cancelled_at = clock_timestamp() where id = p_invite_id;
  return query select true, v_inv.starts_at > clock_timestamp(), v_inv.message_id;
end;
$$;

revoke all on function public.cancel_training_invite(uuid) from public, anon;
grant execute on function public.cancel_training_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- set_training_invite_rsvp — the caller's own answer: 'going', 'maybe', or
-- NULL to withdraw it. Idempotent: repeating the same value writes nothing and
-- does not bump rsvp_version (so no spurious realtime traffic). An invitation
-- that does not exist, belongs to another team, or whose message was deleted
-- looks the same as one that never existed, apart from the closed/started
-- states, which are only reachable by team members anyway. This never creates
-- a workout, points, a feed item, a message or a notification.
-- ---------------------------------------------------------------------------
create or replace function public.set_training_invite_rsvp(p_invite_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_inv public.training_invites%rowtype;
  v_rows integer;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_status is not null and p_status not in ('going', 'maybe') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into v_inv from public.training_invites where id = p_invite_id for update;
  if not found or not public.is_team_member(v_inv.team_id) then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;
  if v_inv.cancelled_at is not null
     or exists (select 1 from public.messages m where m.id = v_inv.message_id and m.deleted_at is not null) then
    raise exception 'invite_closed' using errcode = 'P0001';
  end if;
  if v_inv.starts_at <= clock_timestamp() then
    raise exception 'invite_started' using errcode = 'P0001';
  end if;

  if p_status is null then
    delete from public.training_invite_rsvps where invite_id = p_invite_id and user_id = v_me;
    get diagnostics v_rows = row_count;
  else
    insert into public.training_invite_rsvps (invite_id, team_id, user_id, status)
    values (p_invite_id, v_inv.team_id, v_me, p_status)
    on conflict (invite_id, user_id) do update set status = excluded.status
      where public.training_invite_rsvps.status is distinct from excluded.status;
    get diagnostics v_rows = row_count;
  end if;

  if v_rows > 0 then
    update public.training_invites set rsvp_version = rsvp_version + 1 where id = p_invite_id;
  end if;

  return p_status;
end;
$$;

revoke all on function public.set_training_invite_rsvp(uuid, text) from public, anon;
grant execute on function public.set_training_invite_rsvp(uuid, text) to authenticated;
