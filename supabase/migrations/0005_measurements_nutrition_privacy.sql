-- ---------------------------------------------------------------------------
-- privacy_settings (created first: other policies below reference it)
-- ---------------------------------------------------------------------------
create table public.privacy_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  body_measurements_visibility text not null default 'private' check (body_measurements_visibility in ('private', 'team', 'selected')),
  nutrition_visibility text not null default 'private' check (nutrition_visibility in ('private', 'team', 'selected')),
  activity_feed_opt_in boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger privacy_settings_set_updated_at
  before update on public.privacy_settings
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_profile_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.privacy_settings (user_id) values (new.id) on conflict do nothing;
  insert into public.user_metric_preferences (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- body_measurements — PRIVATE BY DEFAULT, owner-only in v1.
-- ---------------------------------------------------------------------------
create table public.body_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  measured_at date not null default current_date,
  weight_kg numeric(5, 1),
  biceps_cm numeric(5, 1),
  waist_cm numeric(5, 1),
  chest_cm numeric(5, 1),
  hip_cm numeric(5, 1),
  thigh_cm numeric(5, 1),
  body_fat_pct numeric(4, 1),
  neck_cm numeric(5, 1),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, measured_at)
);

create index body_measurements_user_id_idx on public.body_measurements (user_id);

create trigger body_measurements_set_updated_at
  before update on public.body_measurements
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- nutrition_entries — one row per user per day, PRIVATE.
-- ---------------------------------------------------------------------------
create table public.nutrition_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  entry_date date not null default current_date,
  calories_kcal int,
  protein_g numeric(6, 1),
  carbs_g numeric(6, 1),
  fat_g numeric(6, 1),
  water_ml int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, entry_date)
);

create index nutrition_entries_user_id_idx on public.nutrition_entries (user_id);

create trigger nutrition_entries_set_updated_at
  before update on public.nutrition_entries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- user_metric_preferences — which optional metrics a user has opted into.
-- ---------------------------------------------------------------------------
create table public.user_metric_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  enabled_metrics text[] not null default '{}',
  calorie_goal_kcal int,
  protein_goal_g numeric(6, 1),
  carbs_goal_g numeric(6, 1),
  fat_goal_g numeric(6, 1),
  water_goal_ml int,
  steps_goal int default 10000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_metric_preferences_set_updated_at
  before update on public.user_metric_preferences
  for each row execute function public.set_updated_at();

-- Now that both dependent tables exist, wire up the profile-created trigger.
create trigger on_profile_created_defaults
  after insert on public.profiles
  for each row execute function public.handle_new_profile_defaults();

-- ---------------------------------------------------------------------------
-- RLS — all four tables are strictly owner-only. Team admins have NO
-- read/write access, by design (health-data privacy overrides team_admin).
-- ---------------------------------------------------------------------------
alter table public.body_measurements enable row level security;
alter table public.nutrition_entries enable row level security;
alter table public.user_metric_preferences enable row level security;
alter table public.privacy_settings enable row level security;

create policy "body_measurements_owner_all" on public.body_measurements
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "nutrition_entries_owner_all" on public.nutrition_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "user_metric_preferences_owner_all" on public.user_metric_preferences
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "privacy_settings_owner_all" on public.privacy_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
