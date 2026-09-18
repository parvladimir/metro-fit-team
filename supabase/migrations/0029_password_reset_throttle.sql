-- Throttle log for app-sent password recovery e-mails. Written/read only by
-- the server with the service role (RLS on, no policies => no client access).
-- Stores a hash of the address, never the address itself.
create table if not exists public.password_reset_requests (
  id uuid primary key default gen_random_uuid(),
  email_hash text not null,
  requested_at timestamptz not null default now()
);
create index if not exists password_reset_requests_hash_time_idx on public.password_reset_requests (email_hash, requested_at desc);
create index if not exists password_reset_requests_time_idx on public.password_reset_requests (requested_at desc);
alter table public.password_reset_requests enable row level security;
revoke all on public.password_reset_requests from anon, authenticated;
