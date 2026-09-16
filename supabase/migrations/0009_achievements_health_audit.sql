-- ---------------------------------------------------------------------------
-- achievements (catalogue) + user_achievements (unlocks)
-- ---------------------------------------------------------------------------
create table public.achievements (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title_key text not null,
  description_key text not null,
  icon text not null default '🏆'
);

create table public.user_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  achievement_id uuid not null references public.achievements (id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  unique (user_id, achievement_id)
);

create index user_achievements_user_id_idx on public.user_achievements (user_id);

insert into public.achievements (code, title_key, description_key, icon) values
  ('first_workout', 'achievements.firstWorkout.title', 'achievements.firstWorkout.description', '🥇'),
  ('ten_workouts', 'achievements.tenWorkouts.title', 'achievements.tenWorkouts.description', '💪'),
  ('four_week_streak', 'achievements.fourWeekStreak.title', 'achievements.fourWeekStreak.description', '🔥'),
  ('thousand_minutes', 'achievements.thousandMinutes.title', 'achievements.thousandMinutes.description', '⏱️'),
  ('weekly_goal_reached', 'achievements.weeklyGoalReached.title', 'achievements.weeklyGoalReached.description', '🎯'),
  ('challenge_completed', 'achievements.challengeCompleted.title', 'achievements.challengeCompleted.description', '🏆')
on conflict (code) do nothing;

-- Grants an achievement at most once and drops an activity_feed entry.
create or replace function public.grant_achievement(p_user_id uuid, p_code text, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_achievement_id uuid;
  v_inserted boolean;
begin
  select id into v_achievement_id from public.achievements where code = p_code;
  if v_achievement_id is null then
    return;
  end if;

  insert into public.user_achievements (user_id, achievement_id)
  values (p_user_id, v_achievement_id)
  on conflict do nothing
  returning true into v_inserted;

  if v_inserted and p_team_id is not null then
    insert into public.activity_feed (team_id, user_id, event_type, message_key, params)
    values (p_team_id, p_user_id, 'achievement_unlocked', 'feed.achievementUnlocked', jsonb_build_object('achievementCode', p_code));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- health_connections — scaffolding for the future native app; unused by the
-- web client in v1 beyond reporting "not connected".
-- ---------------------------------------------------------------------------
create table public.health_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null check (provider in ('apple_health', 'health_connect')),
  status text not null default 'disconnected' check (status in ('connected', 'disconnected')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create trigger health_connections_set_updated_at
  before update on public.health_connections
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- audit_events — administrative action log (no health data ever recorded)
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams (id) on delete cascade,
  actor_user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_team_id_created_at_idx on public.audit_events (team_id, created_at desc);

create or replace function public.log_audit_event(
  p_team_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_events (team_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_team_id, p_actor_user_id, p_action, p_entity_type, p_entity_id, p_metadata);
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;
alter table public.health_connections enable row level security;
alter table public.audit_events enable row level security;

create policy "achievements_select_all_authenticated" on public.achievements
  for select using (auth.role() = 'authenticated');

create policy "user_achievements_select_own_or_teammate" on public.user_achievements
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.team_members me
      join public.team_members them on them.team_id = me.team_id
      where me.user_id = auth.uid() and them.user_id = public.user_achievements.user_id
    )
  );

create policy "health_connections_owner_all" on public.health_connections
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "audit_events_admin_select" on public.audit_events
  for select using (team_id is not null and public.is_team_admin(team_id));
