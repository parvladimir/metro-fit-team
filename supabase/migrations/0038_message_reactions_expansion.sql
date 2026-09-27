-- ---------------------------------------------------------------------------
-- Generalizes the single "support" reaction into a 20-emoji reaction system,
-- reusable on any top-level, non-deleted message (not just system events).
-- Preserves every existing reaction row (same id/user/message/created_at) and
-- the existing permanent notification-dedup guarantee — neither is touched.
-- ---------------------------------------------------------------------------

-- 1. Widen the target rule: any top-level, non-deleted message can be reacted
--    to now, not only system events. Thread replies and deleted messages stay
--    excluded.
create or replace function public.prepare_message_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg record;
begin
  select team_id, parent_message_id, deleted_at into v_msg from public.messages where id = new.message_id;
  if not found or v_msg.parent_message_id is not null or v_msg.deleted_at is not null then
    raise exception 'invalid_reaction_target' using errcode = '22023';
  end if;
  new.team_id := v_msg.team_id;
  return new;
end;
$$;

-- 2. One reaction per user per message (was: one per user per message PER
--    TYPE, which allowed stacking several types at once — never actually
--    reachable since only one type ever existed, but must be closed now that
--    20 do). Constraint names are discovered dynamically rather than guessed,
--    mirroring the existing pattern in 0031 for the notifications category
--    check.
alter table public.message_reactions add column if not exists updated_at timestamptz not null default now();

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
alter table public.message_reactions add constraint message_reactions_message_id_user_id_key unique (message_id, user_id);

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.message_reactions'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%reaction_type%'
  loop
    execute format('alter table public.message_reactions drop constraint %I', c.conname);
  end loop;
end $$;

-- Preserve every existing "support" reaction in place (same row: same id,
-- user_id, message_id, created_at — never delete+reinsert, so this can never
-- re-trigger a notification). Must run AFTER the old check constraint is
-- dropped (it only allowed 'support') and BEFORE the new one is added below
-- (which doesn't allow 'support') — a real production run with existing
-- 'support' rows hit exactly this ordering bug when the two statements were
-- reversed: the new constraint's validation scan failed against rows that
-- hadn't been migrated yet (local dev never caught it, since a fresh reset
-- never has a pre-existing 'support' row to violate anything).
update public.message_reactions set reaction_type = 'heart' where reaction_type = 'support';

alter table public.message_reactions add constraint message_reactions_reaction_type_check
  check (reaction_type in (
    'thumbs_up', 'heart', 'fire', 'muscle', 'clap', 'laugh', 'smile', 'heart_eyes', 'cool', 'star_struck',
    'surprised', 'thinking', 'sad', 'sweat_smile', 'raised_hands', 'thanks', 'party', 'trophy', 'hundred', 'rocket'
  ));

alter table public.message_reactions alter column reaction_type set default 'heart';

-- 3. Atomic, idempotent mutation RPC. The caller decides null-vs-a-key from
--    its own displayed state (never "flip whatever's there"), so a retried
--    call converges to the same end state instead of toggling. There is no
--    user_id parameter — the actor is always auth.uid(), so forging someone
--    else's reaction isn't just RLS-forbidden, it's impossible to express.
create or replace function public.set_message_reaction(p_message_id uuid, p_reaction_key text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg record;
  v_was_inserted boolean;
begin
  select team_id, parent_message_id, deleted_at into v_msg from public.messages where id = p_message_id;
  if not found or v_msg.parent_message_id is not null or v_msg.deleted_at is not null then
    raise exception 'invalid_reaction_target' using errcode = '22023';
  end if;
  if not public.is_team_member(v_msg.team_id) then
    raise exception 'not_a_team_member' using errcode = '42501';
  end if;

  if p_reaction_key is null then
    delete from public.message_reactions where message_id = p_message_id and user_id = auth.uid();
    if found then return 'deleted'; else return 'noop'; end if;
  end if;

  if p_reaction_key not in (
    'thumbs_up', 'heart', 'fire', 'muscle', 'clap', 'laugh', 'smile', 'heart_eyes', 'cool', 'star_struck',
    'surprised', 'thinking', 'sad', 'sweat_smile', 'raised_hands', 'thanks', 'party', 'trophy', 'hundred', 'rocket'
  ) then
    raise exception 'invalid_reaction_key' using errcode = '22023';
  end if;

  -- xmax = 0 on the row RETURNING gives us is the standard, race-free way to
  -- tell an insert from an on-conflict update in one atomic statement: the
  -- row lock Postgres takes to safely apply the DO UPDATE branch sets xmax,
  -- which a genuinely fresh insert never does. This is what lets the caller
  -- know (without a separate, racy pre-check query) whether this was a true
  -- first reaction worth possibly notifying about, or a same-actor replace.
  insert into public.message_reactions (message_id, team_id, user_id, reaction_type)
  values (p_message_id, v_msg.team_id, auth.uid(), p_reaction_key)
  on conflict (message_id, user_id)
  do update set reaction_type = excluded.reaction_type, updated_at = now()
  returning (xmax = 0) into v_was_inserted;

  return case when v_was_inserted then 'inserted' else 'updated' end;
end;
$$;

revoke all on function public.set_message_reaction(uuid, text) from public, anon;
grant execute on function public.set_message_reaction(uuid, text) to authenticated;

-- 4. Notification trigger stays a trigger (its dedup index is untouched and
--    already fires exactly once per (owner, message, actor) regardless of
--    emoji); it just learns the target's type and the emoji key used, so the
--    push/in-app text can say "Nachricht" vs. "Training" and show the right
--    emoji instead of a hardcoded 💪.
create or replace function public.notify_event_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_meta jsonb;
  v_type text;
  v_name text;
begin
  select user_id, metadata, message_type into v_owner, v_meta, v_type from public.messages where id = new.message_id;
  if v_owner is null or v_owner = new.user_id then return new; end if;
  select coalesce(nullif(btrim(full_name), ''), 'Jemand') into v_name from public.profiles where id = new.user_id;
  insert into public.notifications (user_id, category, title_key, params, message_id, actor_id, kind)
  values (v_owner, 'reaktion_antwort', 'notification.reaction',
          jsonb_build_object('actor_name', v_name, 'event_title', v_meta ->> 'title',
                              'reaction_key', new.reaction_type, 'is_workout', v_type = 'system'),
          new.message_id, new.user_id, 'reaction')
  on conflict (user_id, message_id, actor_id) where kind = 'reaction' do nothing;
  return new;
end;
$$;

-- 5. Backfill historical reaction notifications so they render correctly
--    under the new emoji/target-aware wording. Every pre-migration reaction
--    was necessarily on a workout event (the only reactable type until now)
--    and was the heart, so both fields backfill to a fixed value.
update public.notifications
set params = params || jsonb_build_object('reaction_key', 'heart', 'is_workout', true)
where kind = 'reaction' and not (params ? 'reaction_key');
