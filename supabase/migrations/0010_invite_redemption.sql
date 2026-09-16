-- ---------------------------------------------------------------------------
-- redeem_team_invite — the ONLY way a client can join a team. Runs as
-- SECURITY DEFINER so it can insert into team_members (which has no direct
-- client insert policy), but it never trusts anything from the client except
-- the raw invite token itself, which is checked against a stored hash.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_team_invite(p_token text)
returns table (team_id uuid, team_name text, already_member boolean)
language plpgsql
security definer
set search_path = public
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
    select 1 from public.team_members
    where team_id = v_invite.team_id and user_id = auth.uid()
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

grant execute on function public.redeem_team_invite(text) to authenticated;
