-- ---------------------------------------------------------------------------
-- audit_events has no client INSERT policy (by design), so audit inserts made
-- with a user session were silently dropped. log_audit_event() is
-- SECURITY DEFINER but executable by PUBLIC, i.e. anyone could forge entries.
-- Add a checked wrapper for team admins and lock the raw function down.
-- ---------------------------------------------------------------------------
create or replace function public.log_team_admin_audit(
  p_team_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_team_admin(p_team_id) then
    raise exception 'not_team_admin' using errcode = '42501';
  end if;
  insert into public.audit_events (team_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_team_id, auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

revoke all on function public.log_team_admin_audit(uuid, text, text, uuid, jsonb) from public, anon;
grant execute on function public.log_team_admin_audit(uuid, text, text, uuid, jsonb) to authenticated;

revoke all on function public.log_audit_event(uuid, uuid, text, text, uuid, jsonb) from public, anon, authenticated;
