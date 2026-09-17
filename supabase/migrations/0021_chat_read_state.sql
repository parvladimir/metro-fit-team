-- ---------------------------------------------------------------------------
-- Server-backed read state for team chat, so the unread badge is real
-- (not React/localStorage state) and survives across devices/reloads.
-- One row per (user, team) — a plain per-message read receipt table would
-- be overkill for a single team chat and would multiply write volume.
-- ---------------------------------------------------------------------------
create table public.team_message_read_state (
  user_id uuid not null references public.profiles (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  last_read_message_id uuid references public.messages (id) on delete set null,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, team_id)
);

create index team_message_read_state_team_id_idx on public.team_message_read_state (team_id);

create trigger team_message_read_state_set_updated_at
  before update on public.team_message_read_state
  for each row execute function public.set_updated_at();

alter table public.team_message_read_state enable row level security;

-- A user can only ever see/write their own read-state row, and only for a
-- team they actually belong to — this is what keeps unread counts
-- team-isolated (an outsider can't read or forge another team's state, and
-- can't mark a team they're not in as "read").
create policy "read_state_select_own" on public.team_message_read_state
  for select using (user_id = auth.uid());

create policy "read_state_insert_own" on public.team_message_read_state
  for insert with check (user_id = auth.uid() and public.is_team_member(team_id));

create policy "read_state_update_own" on public.team_message_read_state
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- get_unread_chat_count — single lightweight aggregate query (indexed on
-- messages(team_id, created_at) already), never counts the caller's own
-- messages, and treats "never read, never had a read-state row" as
-- "unread since I joined the team" rather than "unread since the dawn of
-- the chat" so a new member isn't hit with a huge stale unread count.
-- ---------------------------------------------------------------------------
create or replace function public.get_unread_chat_count(p_team_id uuid)
returns bigint
language plpgsql
security invoker
stable
set search_path = public
as $$
declare
  v_since timestamptz;
begin
  if not public.is_team_member(p_team_id) then
    raise exception 'not_a_team_member' using errcode = '42501';
  end if;

  select coalesce(
    (select last_read_at from public.team_message_read_state where user_id = auth.uid() and team_id = p_team_id),
    (select joined_at from public.team_members where user_id = auth.uid() and team_id = p_team_id),
    'epoch'::timestamptz
  ) into v_since;

  return (
    select count(*)::bigint
    from public.messages m
    where m.team_id = p_team_id
      and m.user_id <> auth.uid()
      and m.deleted_at is null
      and m.created_at > v_since
  );
end;
$$;

grant execute on function public.get_unread_chat_count(uuid) to authenticated;
