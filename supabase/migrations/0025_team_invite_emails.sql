-- ---------------------------------------------------------------------------
-- Email delivery log for team invitations. The invite itself is still a
-- normal team_invites row (hashed token, expiry, revocation, max uses,
-- redeem_team_invite()) — this table only records "an invite link was mailed
-- to X" so admins can see it and so sending can be rate limited.
-- Invited addresses are visible to team admins ONLY.
-- ---------------------------------------------------------------------------
create table public.team_invite_emails (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  invite_id uuid references public.team_invites (id) on delete set null,
  invited_by uuid not null references public.profiles (id) on delete cascade,
  email text not null check (char_length(email) between 3 and 254),
  status text not null check (status in ('sent', 'failed')),
  created_at timestamptz not null default now()
);

create index team_invite_emails_team_created_idx on public.team_invite_emails (team_id, created_at desc);
create index team_invite_emails_actor_created_idx on public.team_invite_emails (invited_by, created_at desc);

alter table public.team_invite_emails enable row level security;

create policy "team_invite_emails_admin_select" on public.team_invite_emails
  for select using (public.is_team_admin(team_id));

create policy "team_invite_emails_admin_insert" on public.team_invite_emails
  for insert with check (public.is_team_admin(team_id) and invited_by = auth.uid());

create policy "team_invite_emails_admin_update" on public.team_invite_emails
  for update using (public.is_team_admin(team_id) and invited_by = auth.uid())
  with check (public.is_team_admin(team_id) and invited_by = auth.uid());

-- DB-level rate limit (independent of the app): max 5 mails / minute per
-- admin and 30 mails / hour per team, counting failed attempts too so a
-- compromised admin session cannot spam through the provider.
create or replace function public.enforce_invite_email_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.team_invite_emails
      where invited_by = new.invited_by and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'invite_rate_limited' using errcode = 'P0001';
  end if;
  if (select count(*) from public.team_invite_emails
      where team_id = new.team_id and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'invite_rate_limited' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger team_invite_emails_rate_limit
  before insert on public.team_invite_emails
  for each row execute function public.enforce_invite_email_rate_limit();
