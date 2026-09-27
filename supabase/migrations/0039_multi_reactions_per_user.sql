-- ---------------------------------------------------------------------------
-- Allows a user to hold several DIFFERENT reactions on the same message at
-- once (was: one active reaction per user per message, replaced by picking
-- another). Only the uniqueness rule and the mutation RPC change — the
-- target-validity trigger, RLS policies, and the notification trigger (its
-- dedup is already keyed by owner/message/actor, not by emoji) are untouched.
-- ---------------------------------------------------------------------------

-- 1. Widen (message_id, user_id) to (message_id, user_id, reaction_type).
--    This is strictly less restrictive than the constraint it replaces, so
--    unlike 0038's check-constraint change, no existing row can ever violate
--    it — a set of rows unique on 2 columns is automatically unique on 3.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.message_reactions'::regclass and contype = 'u'
  loop
    execute format('alter table public.message_reactions drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.message_reactions add constraint message_reactions_message_id_user_id_reaction_type_key
  unique (message_id, user_id, reaction_type);

-- 2. Replace the mutation RPC with an explicit per-emoji toggle. The old
--    "pick one key, it replaces whatever was there" RPC is dropped outright
--    (different arity — a bare CREATE OR REPLACE would leave both overloads
--    callable side by side, as already documented for this exact function in
--    0038's own header comment).
drop function if exists public.set_message_reaction(uuid, text);

create or replace function public.set_message_reaction(p_message_id uuid, p_reaction_key text, p_active boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg record;
begin
  select team_id, parent_message_id, deleted_at into v_msg from public.messages where id = p_message_id;
  if not found or v_msg.parent_message_id is not null or v_msg.deleted_at is not null then
    raise exception 'invalid_reaction_target' using errcode = '22023';
  end if;
  if not public.is_team_member(v_msg.team_id) then
    raise exception 'not_a_team_member' using errcode = '42501';
  end if;
  if p_reaction_key not in (
    'thumbs_up', 'heart', 'fire', 'muscle', 'clap', 'laugh', 'smile', 'heart_eyes', 'cool', 'star_struck',
    'surprised', 'thinking', 'sad', 'sweat_smile', 'raised_hands', 'thanks', 'party', 'trophy', 'hundred', 'rocket'
  ) then
    raise exception 'invalid_reaction_key' using errcode = '22023';
  end if;

  -- Each (message, user, emoji) triple is now its own independent fact — no
  -- more "replace", so no more xmax trick is needed: a plain conflict-safe
  -- insert or a scoped delete, and FOUND tells the caller whether anything
  -- actually changed. Repeating the same (key, active) call converges to the
  -- same end state instead of toggling, exactly like the RPC it replaces.
  if p_active then
    insert into public.message_reactions (message_id, team_id, user_id, reaction_type)
    values (p_message_id, v_msg.team_id, auth.uid(), p_reaction_key)
    on conflict (message_id, user_id, reaction_type) do nothing;
    if found then return 'added'; else return 'noop'; end if;
  else
    -- Scoped to this one emoji only — never touches the user's other
    -- reactions on the same message.
    delete from public.message_reactions
      where message_id = p_message_id and user_id = auth.uid() and reaction_type = p_reaction_key;
    if found then return 'removed'; else return 'noop'; end if;
  end if;
end;
$$;

revoke all on function public.set_message_reaction(uuid, text, boolean) from public, anon;
grant execute on function public.set_message_reaction(uuid, text, boolean) to authenticated;
