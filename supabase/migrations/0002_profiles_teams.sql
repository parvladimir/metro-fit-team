-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  fitness_goal text check (fitness_goal in (
    'general_fitness', 'lose_weight', 'build_muscle', 'improve_strength', 'improve_endurance', 'stay_fit'
  )),
  weekly_goal smallint check (weekly_goal between 1 and 7) default 3,
  height_cm numeric(5, 1),
  birth_date date,
  locale text not null default 'de' check (locale in ('de', 'en', 'ru')),
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row whenever a Supabase Auth user is created.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- teams
-- ---------------------------------------------------------------------------
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger teams_set_updated_at
  before update on public.teams
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- team_members
-- ---------------------------------------------------------------------------
create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'team_admin')),
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, user_id)
);

create index team_members_user_id_idx on public.team_members (user_id);
create index team_members_team_id_idx on public.team_members (team_id);

create trigger team_members_set_updated_at
  before update on public.team_members
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- team_invites
-- ---------------------------------------------------------------------------
create table public.team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  token_hash text not null unique,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  max_uses int check (max_uses is null or max_uses > 0),
  use_count int not null default 0
);

create index team_invites_team_id_idx on public.team_invites (team_id);

-- ---------------------------------------------------------------------------
-- Authorization helper functions (SECURITY DEFINER to avoid RLS recursion)
-- ---------------------------------------------------------------------------
create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_team_admin(p_team_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = auth.uid() and role = 'team_admin'
  );
$$;

create or replace function public.current_team_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select team_id from public.team_members where user_id = auth.uid();
$$;

grant execute on function public.is_team_member(uuid) to authenticated;
grant execute on function public.is_team_admin(uuid) to authenticated;
grant execute on function public.current_team_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invites enable row level security;

-- profiles: everyone can read the public-safe columns of teammates' profiles
-- (name/avatar) via the app layer, but at the row level we allow reading any
-- profile that shares a team, plus your own profile always.
create policy "profiles_select_own_or_teammate" on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1 from public.team_members me
      join public.team_members them on them.team_id = me.team_id
      where me.user_id = auth.uid() and them.user_id = public.profiles.id
    )
  );

create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid());

create policy "profiles_insert_own" on public.profiles
  for insert with check (id = auth.uid());

-- teams: readable by members only
create policy "teams_select_member" on public.teams
  for select using (public.is_team_member(id));

create policy "teams_update_admin" on public.teams
  for update using (public.is_team_admin(id));

-- team creation happens only through the server-side bootstrap/onboarding
-- function (security definer), not directly by clients.

-- team_members: members can see their team's roster; only admins can modify
create policy "team_members_select_teammates" on public.team_members
  for select using (public.is_team_member(team_id));

create policy "team_members_admin_update" on public.team_members
  for update using (public.is_team_admin(team_id));

create policy "team_members_admin_delete" on public.team_members
  for delete using (public.is_team_admin(team_id));

-- No direct insert policy: joining happens only via the redeem_team_invite()
-- security-definer function, so a client cannot self-assign to any team or
-- forge a team_admin role by crafting an insert.

-- team_invites: only team admins may list/manage invites for their team.
-- Redemption is handled by a SECURITY DEFINER function so the raw token
-- never has to be readable via a SELECT policy.
create policy "team_invites_admin_select" on public.team_invites
  for select using (public.is_team_admin(team_id));

create policy "team_invites_admin_insert" on public.team_invites
  for insert with check (public.is_team_admin(team_id) and created_by = auth.uid());

create policy "team_invites_admin_update" on public.team_invites
  for update using (public.is_team_admin(team_id));
