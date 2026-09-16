-- ---------------------------------------------------------------------------
-- messages — team chat (Supabase Realtime broadcasts table changes)
-- ---------------------------------------------------------------------------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  reply_to_id uuid references public.messages (id) on delete set null,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create index messages_team_id_created_at_idx on public.messages (team_id, created_at);

alter publication supabase_realtime add table public.messages;

-- ---------------------------------------------------------------------------
-- activity_feed — translatable, structured feed entries (never raw health
-- data). message_key + params are resolved through the i18n dictionary on
-- the client, so the feed stays localizable.
-- ---------------------------------------------------------------------------
create table public.activity_feed (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  event_type text not null check (event_type in (
    'workout_completed', 'weekly_goal_reached', 'team_challenge_completed',
    'challenge_completed', 'member_joined', 'achievement_unlocked'
  )),
  message_key text not null,
  params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index activity_feed_team_id_created_at_idx on public.activity_feed (team_id, created_at desc);

alter publication supabase_realtime add table public.activity_feed;

-- ---------------------------------------------------------------------------
-- notifications + per-category preferences
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  category text not null check (category in (
    'trainingserinnerung', 'wochenziel', 'messungserinnerung', 'herausforderung', 'team_aktivitaet', 'wochenzusammenfassung'
  )),
  title_key text not null,
  body_key text,
  params jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_id_created_at_idx on public.notifications (user_id, created_at desc);

alter publication supabase_realtime add table public.notifications;

create table public.notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  trainingserinnerung boolean not null default true,
  wochenziel boolean not null default true,
  messungserinnerung boolean not null default true,
  herausforderung boolean not null default true,
  team_aktivitaet boolean not null default true,
  wochenzusammenfassung boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger notification_preferences_set_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_profile_notification_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_preferences (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_profile_created_notification_defaults
  after insert on public.profiles
  for each row execute function public.handle_new_profile_notification_defaults();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.messages enable row level security;
alter table public.activity_feed enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;

create policy "messages_select_team" on public.messages
  for select using (public.is_team_member(team_id));

create policy "messages_insert_team" on public.messages
  for insert with check (public.is_team_member(team_id) and user_id = auth.uid());

create policy "messages_update_own" on public.messages
  for update using (user_id = auth.uid());

create policy "activity_feed_select_team" on public.activity_feed
  for select using (public.is_team_member(team_id));

-- activity_feed rows are only ever inserted by trusted trigger functions
-- (SECURITY DEFINER), never directly by clients — this is what lets us
-- guarantee private health data never lands in the feed.

create policy "notifications_owner_all" on public.notifications
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "notification_preferences_owner_all" on public.notification_preferences
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
