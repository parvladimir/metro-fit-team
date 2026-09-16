-- ---------------------------------------------------------------------------
-- team_ranking_rules — one configurable row per team (team_admin editable).
-- ---------------------------------------------------------------------------
create table public.team_ranking_rules (
  team_id uuid primary key references public.teams (id) on delete cascade,
  points_workout_completed int not null default 100,
  points_duration_bonus int not null default 40,
  duration_bonus_threshold_minutes int not null default 30,
  points_weekly_goal_reached int not null default 150,
  points_consistency_bonus int not null default 20,
  consistency_bonus_min_days int not null default 3,
  points_daily_step_goal int not null default 20,
  points_challenge_completed int not null default 100,
  points_team_challenge_participation int not null default 50,
  daily_cap_points int not null default 200,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

create trigger team_ranking_rules_set_updated_at
  before update on public.team_ranking_rules
  for each row execute function public.set_updated_at();

-- Every team automatically gets a default ranking-rules row.
create or replace function public.handle_new_team_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.team_ranking_rules (team_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_team_created_defaults
  after insert on public.teams
  for each row execute function public.handle_new_team_defaults();

-- ---------------------------------------------------------------------------
-- fitness_score_events — append-only, auditable ledger of every point award.
-- ---------------------------------------------------------------------------
create table public.fitness_score_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  event_type text not null check (event_type in (
    'workout_completed', 'workout_duration_bonus', 'weekly_goal_reached',
    'consistency_bonus', 'daily_step_goal', 'challenge_completed', 'team_challenge_participation'
  )),
  points int not null check (points >= 0),
  event_date date not null default current_date,
  source_entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index fitness_score_events_user_id_idx on public.fitness_score_events (user_id);
create index fitness_score_events_team_id_idx on public.fitness_score_events (team_id);
create index fitness_score_events_event_date_idx on public.fitness_score_events (event_date);

-- Prevent duplicate rewards for the same concrete source (e.g. the same
-- workout id cannot trigger workout_completed twice).
create unique index fitness_score_events_source_uq
  on public.fitness_score_events (user_id, event_type, source_entity_id)
  where source_entity_id is not null;

-- Prevent duplicate once-per-day/week rewards that have no natural source
-- entity (e.g. weekly_goal_reached is keyed by the week's Monday date).
create unique index fitness_score_events_dateonly_uq
  on public.fitness_score_events (user_id, event_type, event_date)
  where source_entity_id is null;

-- ---------------------------------------------------------------------------
-- fitness_score_totals — fast weekly rollup cache for ranking queries.
-- ---------------------------------------------------------------------------
create table public.fitness_score_totals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  iso_year int not null,
  iso_week int not null,
  points int not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, team_id, iso_year, iso_week)
);

create index fitness_score_totals_lookup_idx on public.fitness_score_totals (team_id, iso_year, iso_week);

create or replace function public.handle_score_event_rollup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.fitness_score_totals (user_id, team_id, iso_year, iso_week, points, updated_at)
  values (
    new.user_id, new.team_id,
    extract(isoyear from new.event_date)::int,
    extract(week from new.event_date)::int,
    new.points,
    now()
  )
  on conflict (user_id, team_id, iso_year, iso_week)
  do update set points = public.fitness_score_totals.points + excluded.points, updated_at = now();
  return new;
end;
$$;

create trigger on_score_event_rollup
  after insert on public.fitness_score_events
  for each row execute function public.handle_score_event_rollup();

-- ---------------------------------------------------------------------------
-- award_fitness_score — the single, server-side entry point for granting
-- points. Enforces the per-user daily cap for training-related event types.
-- SECURITY DEFINER: callable only from other trusted server-side functions
-- and triggers below (not granted to `authenticated` directly).
-- ---------------------------------------------------------------------------
create or replace function public.award_fitness_score(
  p_user_id uuid,
  p_team_id uuid,
  p_event_type text,
  p_points int,
  p_event_date date,
  p_source_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rules public.team_ranking_rules%rowtype;
  v_capped_types text[] := array['workout_completed', 'workout_duration_bonus', 'consistency_bonus'];
  v_already_awarded int;
  v_points_to_award int := p_points;
begin
  select * into v_rules from public.team_ranking_rules where team_id = p_team_id;

  if p_event_type = any (v_capped_types) then
    select coalesce(sum(points), 0) into v_already_awarded
    from public.fitness_score_events
    where user_id = p_user_id and event_date = p_event_date and event_type = any (v_capped_types);

    if v_already_awarded >= coalesce(v_rules.daily_cap_points, 200) then
      return; -- cap already reached: award nothing
    end if;

    v_points_to_award := least(p_points, coalesce(v_rules.daily_cap_points, 200) - v_already_awarded);
  end if;

  if v_points_to_award <= 0 then
    return;
  end if;

  insert into public.fitness_score_events (user_id, team_id, event_type, points, event_date, source_entity_id, metadata)
  values (p_user_id, p_team_id, p_event_type, v_points_to_award, p_event_date, p_source_entity_id, p_metadata)
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.team_ranking_rules enable row level security;
alter table public.fitness_score_events enable row level security;
alter table public.fitness_score_totals enable row level security;

create policy "team_ranking_rules_select_member" on public.team_ranking_rules
  for select using (public.is_team_member(team_id));

create policy "team_ranking_rules_admin_update" on public.team_ranking_rules
  for update using (public.is_team_admin(team_id));

-- Ranking is a team-visible aggregate by design (it is the whole point of
-- the feature); the events table only ever carries points + event type,
-- never health data, so team-wide visibility is safe.
create policy "fitness_score_events_select_team" on public.fitness_score_events
  for select using (public.is_team_member(team_id));

create policy "fitness_score_totals_select_team" on public.fitness_score_totals
  for select using (public.is_team_member(team_id));

-- No client-side insert/update policies: all writes to these two tables go
-- exclusively through award_fitness_score() / the rollup trigger, both
-- SECURITY DEFINER and invoked only from other trusted trigger functions.
