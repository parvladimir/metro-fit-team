-- ---------------------------------------------------------------------------
-- Fewer taps during a workout, part 2: personal favourite exercises, recently
-- used exercises, and ONE pinned message in a team chat.
--
--   * exercise_favorites — a private list per user (one row per user + exercise).
--     Owner-only RLS; a favourite can only point at an exercise the user may
--     see (checked in the policy, because a foreign key alone would not).
--     A favourite grants no access to anything: it is a bookmark.
--   * get_recent_exercises — derived from what the user ACTUALLY did (a recorded
--     set), never from opening a picker.
--   * team_chat_pins — at most one row per team pointing at a message. Only a
--     real team_admin of that team can pin, replace or unpin (through the
--     functions below — there is no client write policy). The pin references the
--     ORIGINAL message, so an edit shows up in the preview; deleting the message
--     (or withdrawing a shared plan) clears the pin in the database.
--     Pinning writes no message, no notification and no read-state: it cannot
--     change an unread count or send a push.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Favourites
-- ---------------------------------------------------------------------------
create table public.exercise_favorites (
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Deleting an exercise takes its favourites with it (never a dangling bookmark).
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, exercise_id)
);

create index exercise_favorites_exercise_id_idx on public.exercise_favorites (exercise_id);

alter table public.exercise_favorites enable row level security;

create policy "exercise_favorites_select_own" on public.exercise_favorites
  for select using (user_id = auth.uid());

-- Evaluated with the caller's own rights, so exercises the caller cannot see
-- (someone else's private exercise, another team's) cannot be bookmarked.
create policy "exercise_favorites_insert_own" on public.exercise_favorites
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.exercises e where e.id = exercise_id)
  );

create policy "exercise_favorites_delete_own" on public.exercise_favorites
  for delete using (user_id = auth.uid());

-- A generous ceiling so a list cannot grow without bound.
create or replace function public.limit_exercise_favorites()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.exercise_favorites where user_id = new.user_id) >= 200 then
    raise exception 'favorite_limit_reached' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists exercise_favorites_limit on public.exercise_favorites;
create trigger exercise_favorites_limit
  before insert on public.exercise_favorites
  for each row execute function public.limit_exercise_favorites();

-- ---------------------------------------------------------------------------
-- Recently used exercises: the caller's own exercises with at least one recorded
-- set in a running or finished workout, most recent first, last 180 days.
-- ---------------------------------------------------------------------------
create or replace function public.get_recent_exercises(p_limit integer default 12)
returns table (out_exercise_id uuid, out_last_used_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select we.exercise_id,
         max(coalesce(w.finished_at, w.started_at, w.created_at)) as last_used
    from public.workout_exercises we
    join public.workouts w on w.id = we.workout_id
   where w.user_id = auth.uid()
     and w.status in ('laeuft', 'abgeschlossen')
     and coalesce(w.finished_at, w.started_at, w.created_at) > now() - interval '180 days'
     and exists (select 1 from public.workout_sets s where s.workout_exercise_id = we.id and s.completed)
   group by we.exercise_id
   order by last_used desc
   limit greatest(1, least(coalesce(p_limit, 12), 30));
$$;

-- ---------------------------------------------------------------------------
-- One pinned message per team
-- ---------------------------------------------------------------------------
create table public.team_chat_pins (
  team_id uuid primary key references public.teams (id) on delete cascade,
  -- NULL = nothing pinned. set null (not cascade) so the loss of the message is an UPDATE,
  -- which realtime delivers reliably (a DELETE may reach clients as bare keys under RLS).
  message_id uuid references public.messages (id) on delete set null,
  pinned_by uuid references public.profiles (id) on delete set null,
  pinned_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.team_chat_pins enable row level security;

-- Every member of the team may read the pin; nobody writes it directly.
create policy "team_chat_pins_select_members" on public.team_chat_pins
  for select using (public.is_team_member(team_id));

alter table public.team_chat_pins replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.team_chat_pins;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- pin_team_message: pin (or, with p_replace, replace the pin by) a message.
-- Only a real team_admin of the message's team. "Not found" and "not allowed" are
-- the same answer, so message ids of other teams cannot be probed.
-- ---------------------------------------------------------------------------
create or replace function public.pin_team_message(p_message_id uuid, p_replace boolean default false)
returns table (out_team_id uuid, out_changed boolean, out_replaced boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.messages%rowtype;
  v_current uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  select * into v_msg from public.messages where id = p_message_id;
  if not found or not public.is_team_admin(v_msg.team_id) then
    raise exception 'message_not_found';
  end if;

  -- Only content people can actually see and open in the chat list: not a deleted
  -- message, not an automatic activity event, not a reply inside an event thread,
  -- not a shared plan that was withdrawn.
  if v_msg.deleted_at is not null
     or v_msg.message_type = 'system'
     or v_msg.parent_message_id is not null
     or exists (select 1 from public.plan_shares ps where ps.message_id = v_msg.id and ps.withdrawn_at is not null) then
    raise exception 'message_not_pinnable';
  end if;

  insert into public.team_chat_pins (team_id) values (v_msg.team_id) on conflict (team_id) do nothing;
  select message_id into v_current from public.team_chat_pins where team_id = v_msg.team_id for update;

  if v_current = p_message_id then
    return query select v_msg.team_id, false, false;
    return;
  end if;
  if v_current is not null and not coalesce(p_replace, false) then
    raise exception 'pin_exists';
  end if;

  update public.team_chat_pins
     set message_id = p_message_id,
         pinned_by = auth.uid(),
         pinned_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where team_id = v_msg.team_id;

  return query select v_msg.team_id, true, v_current is not null;
end;
$$;

-- ---------------------------------------------------------------------------
-- unpin_team_message: remove the pin IF it is still this message (so a stale screen
-- cannot undo a newer pin someone else set). Idempotent.
-- ---------------------------------------------------------------------------
create or replace function public.unpin_team_message(p_message_id uuid)
returns table (out_changed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team uuid;
  v_changed boolean := false;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  select team_id into v_team from public.messages where id = p_message_id;
  if v_team is null or not public.is_team_admin(v_team) then
    raise exception 'message_not_found';
  end if;

  update public.team_chat_pins
     set message_id = null, pinned_by = null, pinned_at = null, updated_at = clock_timestamp()
   where team_id = v_team and message_id = p_message_id;
  v_changed := found;

  return query select v_changed;
end;
$$;

-- ---------------------------------------------------------------------------
-- The pin disappears with its message: soft delete, and withdrawing a shared plan.
-- ---------------------------------------------------------------------------
create or replace function public.clear_pin_for_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.team_chat_pins
     set message_id = null, pinned_by = null, pinned_at = null, updated_at = clock_timestamp()
   where message_id = new.id;
  return new;
end;
$$;

drop trigger if exists messages_clear_pin_on_delete on public.messages;
create trigger messages_clear_pin_on_delete
  after update of deleted_at on public.messages
  for each row
  when (new.deleted_at is not null and old.deleted_at is null)
  execute function public.clear_pin_for_message();

create or replace function public.clear_pin_for_withdrawn_share()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.team_chat_pins
     set message_id = null, pinned_by = null, pinned_at = null, updated_at = clock_timestamp()
   where message_id = new.message_id;
  return new;
end;
$$;

drop trigger if exists plan_shares_clear_pin_on_withdraw on public.plan_shares;
create trigger plan_shares_clear_pin_on_withdraw
  after update of withdrawn_at on public.plan_shares
  for each row
  when (new.withdrawn_at is not null and old.withdrawn_at is null)
  execute function public.clear_pin_for_withdrawn_share();

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function public.get_recent_exercises(integer) from public, anon;
grant execute on function public.get_recent_exercises(integer) to authenticated;

revoke all on function public.pin_team_message(uuid, boolean) from public, anon;
grant execute on function public.pin_team_message(uuid, boolean) to authenticated;

revoke all on function public.unpin_team_message(uuid) from public, anon;
grant execute on function public.unpin_team_message(uuid) to authenticated;

revoke all on function public.clear_pin_for_message() from public, anon, authenticated;
revoke all on function public.clear_pin_for_withdrawn_share() from public, anon, authenticated;
revoke all on function public.limit_exercise_favorites() from public, anon, authenticated;
