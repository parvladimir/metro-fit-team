-- ---------------------------------------------------------------------------
-- challenges
-- ---------------------------------------------------------------------------
create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  title text not null,
  description text,
  challenge_type text not null check (challenge_type in ('individual', 'team')),
  metric text not null check (metric in ('workouts_count', 'minutes', 'steps', 'distance_km', 'strength_sessions', 'custom')),
  target_value numeric not null check (target_value > 0),
  starts_at date not null,
  ends_at date not null check (ends_at >= starts_at),
  points_reward int not null default 100,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index challenges_team_id_idx on public.challenges (team_id);

create trigger challenges_set_updated_at
  before update on public.challenges
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- challenge_participants — one row per user per challenge (progress tracked
-- individually even for team-type challenges, then summed for the team bar).
-- ---------------------------------------------------------------------------
create table public.challenge_participants (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  progress_value numeric not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (challenge_id, user_id)
);

create index challenge_participants_challenge_id_idx on public.challenge_participants (challenge_id);
create index challenge_participants_user_id_idx on public.challenge_participants (user_id);

create trigger challenge_participants_set_updated_at
  before update on public.challenge_participants
  for each row execute function public.set_updated_at();

-- Award points + mark completed_at exactly once when progress crosses the
-- challenge's target_value.
create or replace function public.handle_challenge_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge public.challenges%rowtype;
begin
  select * into v_challenge from public.challenges where id = new.challenge_id;

  if new.progress_value >= v_challenge.target_value and new.completed_at is null then
    new.completed_at := now();
    perform public.award_fitness_score(
      new.user_id,
      v_challenge.team_id,
      case when v_challenge.challenge_type = 'team' then 'team_challenge_participation' else 'challenge_completed' end,
      v_challenge.points_reward,
      current_date,
      new.challenge_id,
      jsonb_build_object('challenge_id', new.challenge_id)
    );
  end if;

  return new;
end;
$$;

create trigger on_challenge_progress_update
  before insert or update of progress_value on public.challenge_participants
  for each row execute function public.handle_challenge_progress();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.challenges enable row level security;
alter table public.challenge_participants enable row level security;

create policy "challenges_select_member" on public.challenges
  for select using (public.is_team_member(team_id));

create policy "challenges_admin_insert" on public.challenges
  for insert with check (public.is_team_admin(team_id) and created_by = auth.uid());

create policy "challenges_admin_update" on public.challenges
  for update using (public.is_team_admin(team_id));

create policy "challenges_admin_delete" on public.challenges
  for delete using (public.is_team_admin(team_id));

-- Progress is visible team-wide (needed for the team progress bar), but a
-- user may only insert/update their OWN progress row.
create policy "challenge_participants_select_team" on public.challenge_participants
  for select using (
    exists (select 1 from public.challenges c where c.id = challenge_id and public.is_team_member(c.team_id))
  );

create policy "challenge_participants_self_insert" on public.challenge_participants
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.challenges c where c.id = challenge_id and public.is_team_member(c.team_id))
  );

create policy "challenge_participants_self_update" on public.challenge_participants
  for update using (user_id = auth.uid());
