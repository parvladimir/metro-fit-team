-- ---------------------------------------------------------------------------
-- Fix: redeem_team_invite() declares `returns table (team_id uuid, ...)`,
-- which implicitly creates a PL/pgSQL variable named `team_id` in scope for
-- the whole function body. The membership check then referenced the
-- unqualified column `team_id` inside a query against team_members, which
-- Postgres could not resolve between that variable and the table column —
-- erroring "column reference \"team_id\" is ambiguous" on EVERY redemption
-- attempt (both first-time joins and the already-a-member case). Discovered
-- via manual QR-invite testing against the live project — this made the
-- entire invite feature completely non-functional. Fully qualifying the
-- column reference fixes it.
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
