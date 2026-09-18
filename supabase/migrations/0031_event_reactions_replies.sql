-- ---------------------------------------------------------------------------
-- Reactions + one-level replies on team activity events (system messages), and
-- personal notifications for the event owner. Reuses messages / notifications /
-- notification_preferences / push_subscriptions; no parallel chat system.
-- ---------------------------------------------------------------------------

-- 1. Thread replies. `reply_to_id` (existing) stays a plain quote reference for
--    human chat; `parent_message_id` marks a reply that belongs to an event.
alter table public.messages
  add column if not exists parent_message_id uuid references public.messages (id) on delete cascade;
create index if not exists messages_parent_message_id_idx on public.messages (parent_message_id, created_at)
  where parent_message_id is not null;

create or replace function public.validate_message_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent record;
begin
  if new.parent_message_id is null then return new; end if;
  select team_id, message_type, parent_message_id, deleted_at into v_parent
    from public.messages where id = new.parent_message_id;
  if not found
     or v_parent.team_id <> new.team_id
     or v_parent.message_type <> 'system'
     or v_parent.parent_message_id is not null
     or v_parent.deleted_at is not null
     or new.message_type <> 'text' then
    raise exception 'invalid_thread_parent' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists on_message_thread_validate on public.messages;
create trigger on_message_thread_validate
  before insert on public.messages
  for each row execute function public.validate_message_thread();

-- Thread replies are directed at the event owner (personal notification), so
-- they do not count as team-chat unread.
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
      and m.message_type <> 'system'
      and m.parent_message_id is null
      and m.deleted_at is null
      and m.created_at > v_since
  );
end;
$$;

-- 2. Reactions (V1: a single positive "support" reaction on system events).
create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  reaction_type text not null default 'support' check (reaction_type in ('support')),
  created_at timestamptz not null default now(),
  unique (message_id, user_id, reaction_type)
);
create index if not exists message_reactions_message_id_idx on public.message_reactions (message_id);
create index if not exists message_reactions_user_id_idx on public.message_reactions (user_id);
create index if not exists message_reactions_team_id_idx on public.message_reactions (team_id);

-- team_id is derived from the event (never trusted from the client) and only
-- top-level system events can receive reactions.
create or replace function public.prepare_message_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg record;
begin
  select team_id, message_type, parent_message_id, deleted_at into v_msg from public.messages where id = new.message_id;
  if not found or v_msg.message_type <> 'system' or v_msg.parent_message_id is not null or v_msg.deleted_at is not null then
    raise exception 'invalid_reaction_target' using errcode = '22023';
  end if;
  new.team_id := v_msg.team_id;
  return new;
end;
$$;

drop trigger if exists on_message_reaction_prepare on public.message_reactions;
create trigger on_message_reaction_prepare
  before insert on public.message_reactions
  for each row execute function public.prepare_message_reaction();

alter table public.message_reactions enable row level security;

drop policy if exists "message_reactions_select_team" on public.message_reactions;
create policy "message_reactions_select_team" on public.message_reactions
  for select using (public.is_team_member(team_id));

drop policy if exists "message_reactions_insert_own" on public.message_reactions;
create policy "message_reactions_insert_own" on public.message_reactions
  for insert with check (user_id = auth.uid() and public.is_team_member(team_id));

drop policy if exists "message_reactions_delete_own" on public.message_reactions;
create policy "message_reactions_delete_own" on public.message_reactions
  for delete using (user_id = auth.uid() and public.is_team_member(team_id));

alter table public.message_reactions replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.message_reactions;
exception when duplicate_object then null; end $$;

-- 3. Personal notifications for reactions / replies (reuses `notifications`).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.notifications'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%category%'
  loop
    execute format('alter table public.notifications drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.notifications
  add constraint notifications_category_check check (category in (
    'trainingserinnerung', 'wochenziel', 'messungserinnerung', 'herausforderung', 'team_aktivitaet',
    'wochenzusammenfassung', 'reaktion_antwort'
  )),
  add column if not exists message_id uuid references public.messages (id) on delete cascade,
  add column if not exists actor_id uuid references public.profiles (id) on delete set null,
  add column if not exists kind text check (kind in ('reaction', 'reply'));

-- One reaction notification per (owner, event, actor): re-toggling never spams.
create unique index if not exists notifications_reaction_once_idx
  on public.notifications (user_id, message_id, actor_id) where kind = 'reaction';
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc) where read_at is null;

alter table public.notification_preferences
  add column if not exists reaktionen_antworten boolean not null default true;

create or replace function public.notify_event_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_meta jsonb;
  v_name text;
begin
  select user_id, metadata into v_owner, v_meta from public.messages where id = new.message_id;
  if v_owner is null or v_owner = new.user_id then return new; end if;
  select coalesce(nullif(btrim(full_name), ''), 'Jemand') into v_name from public.profiles where id = new.user_id;
  insert into public.notifications (user_id, category, title_key, params, message_id, actor_id, kind)
  values (v_owner, 'reaktion_antwort', 'notification.reaction',
          jsonb_build_object('actor_name', v_name, 'event_title', v_meta ->> 'title'), new.message_id, new.user_id, 'reaction')
  on conflict (user_id, message_id, actor_id) where kind = 'reaction' do nothing;
  return new;
end;
$$;

drop trigger if exists on_message_reaction_notify on public.message_reactions;
create trigger on_message_reaction_notify
  after insert on public.message_reactions
  for each row execute function public.notify_event_reaction();

create or replace function public.notify_event_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_meta jsonb;
  v_name text;
begin
  if new.parent_message_id is null then return new; end if;
  select user_id, metadata into v_owner, v_meta from public.messages where id = new.parent_message_id;
  if v_owner is null or v_owner = new.user_id then return new; end if;
  select coalesce(nullif(btrim(full_name), ''), 'Jemand') into v_name from public.profiles where id = new.user_id;
  insert into public.notifications (user_id, category, title_key, params, message_id, actor_id, kind)
  values (v_owner, 'reaktion_antwort', 'notification.reply',
          jsonb_build_object('actor_name', v_name, 'event_title', v_meta ->> 'title', 'preview', left(new.content, 120)),
          new.parent_message_id, new.user_id, 'reply');
  return new;
end;
$$;

drop trigger if exists on_message_reply_notify on public.messages;
create trigger on_message_reply_notify
  after insert on public.messages
  for each row execute function public.notify_event_reply();
