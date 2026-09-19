-- Verified creator identity for the chat badge. Keyed by the stable auth user
-- id (never by display name). Purely presentational: nothing in RLS or any
-- policy reads this table, so it grants no permissions. Clients may read it
-- (to render badges) but cannot write it — rows are managed via migrations.
create table if not exists public.platform_creators (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

alter table public.platform_creators enable row level security;

drop policy if exists "platform_creators_read" on public.platform_creators;
create policy "platform_creators_read" on public.platform_creators
  for select to authenticated using (true);

revoke all on public.platform_creators from anon, authenticated;
grant select on public.platform_creators to authenticated;

insert into public.platform_creators (user_id, display_name)
select id, 'Volodymyr Parashchak'
from public.profiles
where id = '1d28b13b-575c-488e-bc71-11f447c4915e'
on conflict (user_id) do nothing;
