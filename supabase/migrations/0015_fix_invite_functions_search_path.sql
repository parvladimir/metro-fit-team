-- ---------------------------------------------------------------------------
-- Fix: redeem_team_invite() and preview_team_invite() call digest() from
-- pgcrypto, but on Supabase projects pgcrypto is installed into the
-- `extensions` schema, not `public`. Both functions pinned
-- `set search_path = public`, so `digest()` could not be resolved and every
-- invite redemption/preview failed with "function digest(text, unknown)
-- does not exist" — discovered by the RLS integration test suite. Adding
-- `extensions` to the search_path fixes it without qualifying every call
-- site. (supabase/migrations/0010 and 0014 are also fixed at the source so
-- a fresh project never hits this; this migration reconciles a project that
-- already applied the broken versions.)
-- ---------------------------------------------------------------------------
create or replace function public.redeem_team_invite(p_token text)
returns table (team_id uuid, team_name text, already_member boolean)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_invite public.team_invites%rowtype;
  v_team public.teams%rowtype;
  v_already_member boolean := false;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_invite
  from public.team_invites
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
  for update;

  if not found then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;

  if v_invite.revoked_at is not null then
    raise exception 'invite_revoked' using errcode = 'P0001';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    raise exception 'invite_expired' using errcode = 'P0001';
  end if;

  if v_invite.max_uses is not null and v_invite.use_count >= v_invite.max_uses then
    raise exception 'invite_exhausted' using errcode = 'P0001';
  end if;

  select exists (
    select 1 from public.team_members tm
    where tm.team_id = v_invite.team_id and tm.user_id = auth.uid()
  ) into v_already_member;

  if not v_already_member then
    insert into public.team_members (team_id, user_id, role)
    values (v_invite.team_id, auth.uid(), 'member');

    update public.team_invites set use_count = use_count + 1 where id = v_invite.id;

    select * into v_team from public.teams where id = v_invite.team_id;

    insert into public.activity_feed (team_id, user_id, event_type, message_key, params)
    values (v_invite.team_id, auth.uid(), 'member_joined', 'feed.memberJoined', '{}'::jsonb);

    perform public.log_audit_event(v_invite.team_id, auth.uid(), 'member_joined', 'team_member', auth.uid(), '{}'::jsonb);
  else
    select * into v_team from public.teams where id = v_invite.team_id;
  end if;

  return query select v_team.id, v_team.name, v_already_member;
end;
$$;

create or replace function public.preview_team_invite(p_token text)
returns table (team_name text, valid boolean)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_invite public.team_invites%rowtype;
  v_team_name text;
begin
  select * into v_invite from public.team_invites where token_hash = encode(digest(p_token, 'sha256'), 'hex');

  if not found then
    return query select null::text, false;
    return;
  end if;

  select name into v_team_name from public.teams where id = v_invite.team_id;

  if v_invite.revoked_at is not null
     or (v_invite.expires_at is not null and v_invite.expires_at < now())
     or (v_invite.max_uses is not null and v_invite.use_count >= v_invite.max_uses) then
    return query select v_team_name, false;
    return;
  end if;

  return query select v_team_name, true;
end;
$$;
