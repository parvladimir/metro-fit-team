-- ---------------------------------------------------------------------------
-- @mentions in team chat. A mention is a relation (message -> user id), not
-- just text: the visible "@Name" stays in the Markdown content, the row says
-- who it really refers to. Only current members of the message's team can be
-- mentioned, only by the message's author, and the stored text is derived
-- from the profile (never taken from the client).
-- ---------------------------------------------------------------------------
create table if not exists public.message_mentions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  mentioned_user_id uuid not null references public.profiles (id) on delete cascade,
  mention_text text not null default '',
  created_at timestamptz not null default now(),
  unique (message_id, mentioned_user_id)
);
create index if not exists message_mentions_message_id_idx on public.message_mentions (message_id);
create index if not exists message_mentions_user_id_idx on public.message_mentions (mentioned_user_id);
create index if not exists message_mentions_team_id_idx on public.message_mentions (team_id);

create or replace function public.prepare_message_mention()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg record;
  v_name text;
begin
  select team_id, user_id, content, message_type, deleted_at into v_msg from public.messages where id = new.message_id;
  if not found or v_msg.message_type = 'system' or v_msg.deleted_at is not null then
    raise exception 'invalid_mention_target' using errcode = '22023';
  end if;
  if auth.uid() is not null and v_msg.user_id <> auth.uid() then
    raise exception 'not_message_author' using errcode = '42501';
  end if;
  if not exists (select 1 from public.team_members where team_id = v_msg.team_id and user_id = new.mentioned_user_id) then
    raise exception 'mentioned_user_not_in_team' using errcode = '42501';
  end if;
  select nullif(btrim(full_name), '') into v_name from public.profiles where id = new.mentioned_user_id;
  if v_name is null then
    raise exception 'mentioned_user_has_no_name' using errcode = '22023';
  end if;
  new.team_id := v_msg.team_id;
  new.mention_text := '@' || v_name;
  if position(new.mention_text in v_msg.content) = 0 then
    raise exception 'mention_not_in_text' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists on_message_mention_prepare on public.message_mentions;
create trigger on_message_mention_prepare
  before insert on public.message_mentions
  for each row execute function public.prepare_message_mention();

alter table public.message_mentions enable row level security;

drop policy if exists "message_mentions_select_team" on public.message_mentions;
create policy "message_mentions_select_team" on public.message_mentions
  for select using (public.is_team_member(team_id));

drop policy if exists "message_mentions_insert_author" on public.message_mentions;
create policy "message_mentions_insert_author" on public.message_mentions
  for insert with check (
    exists (select 1 from public.messages m where m.id = message_id and m.user_id = auth.uid())
  );

drop policy if exists "message_mentions_delete_author" on public.message_mentions;
create policy "message_mentions_delete_author" on public.message_mentions
  for delete using (
    exists (select 1 from public.messages m where m.id = message_id and m.user_id = auth.uid())
  );

alter table public.message_mentions replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.message_mentions;
exception when duplicate_object then null; end $$;

-- Personal notifications: new category + kind, and a preference.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.notifications'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) ilike '%category%' or pg_get_constraintdef(oid) ilike '%kind%')
  loop
    execute format('alter table public.notifications drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.notifications
  add constraint notifications_category_check check (category in (
    'trainingserinnerung', 'wochenziel', 'messungserinnerung', 'herausforderung', 'team_aktivitaet',
    'wochenzusammenfassung', 'reaktion_antwort', 'erwaehnung'
  )),
  add constraint notifications_kind_check check (kind is null or kind in ('reaction', 'reply', 'mention'));

alter table public.notification_preferences
  add column if not exists erwaehnungen boolean not null default true;

-- In-app notification for a mention. Only for a message that has not been
-- edited yet: editing an old message (which may add mentions) never notifies.
create or replace function public.notify_message_mention()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg record;
  v_name text;
begin
  select user_id, parent_message_id, edited_at, content into v_msg from public.messages where id = new.message_id;
  if v_msg.user_id is null or v_msg.user_id = new.mentioned_user_id or v_msg.edited_at is not null then
    return new;
  end if;
  select coalesce(nullif(btrim(full_name), ''), 'Jemand') into v_name from public.profiles where id = v_msg.user_id;
  insert into public.notifications (user_id, category, title_key, params, message_id, actor_id, kind)
  values (new.mentioned_user_id, 'erwaehnung', 'notification.mention',
          jsonb_build_object('actor_name', v_name, 'preview', left(v_msg.content, 120)),
          coalesce(v_msg.parent_message_id, new.message_id), v_msg.user_id, 'mention');
  return new;
end;
$$;

drop trigger if exists on_message_mention_notify on public.message_mentions;
create trigger on_message_mention_notify
  after insert on public.message_mentions
  for each row execute function public.notify_message_mention();
