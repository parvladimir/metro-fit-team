-- ---------------------------------------------------------------------------
-- preview_team_invite — read-only lookup so the "<Team> beitreten?" screen
-- can show the team name before the user commits to joining. Never mutates
-- use_count (only redeem_team_invite does that).
-- ---------------------------------------------------------------------------
create or replace function public.preview_team_invite(p_token text)
returns table (team_name text, valid boolean)
language plpgsql
security definer
set search_path = public
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

grant execute on function public.preview_team_invite(text) to authenticated, anon;
