-- ---------------------------------------------------------------------------
-- Chat: image attachments + automatic team activity events ("system"
-- messages) that are visually and semantically separate from human messages.
-- ---------------------------------------------------------------------------
alter table public.messages
  add column if not exists message_type text not null default 'text'
    check (message_type in ('text', 'image', 'system')),
  add column if not exists attachment_path text,
  add column if not exists attachment_mime text,
  add column if not exists attachment_width int,
  add column if not exists attachment_height int,
  add column if not exists event_type text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Image-only messages have empty text, so relax the old non-empty check.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.messages'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%char_length(content)%'
  loop
    execute format('alter table public.messages drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.messages
  add constraint messages_content_check check (
    (message_type = 'image' and char_length(content) <= 2000)
    or (message_type <> 'image' and char_length(content) between 1 and 2000)
  ),
  add constraint messages_image_path_check check (message_type <> 'image' or attachment_path is not null);

-- Clients may only ever create human messages; system events are written by
-- SECURITY DEFINER triggers below. An image path must live inside the
-- sender's own folder of a team they belong to.
drop policy if exists "messages_insert_team" on public.messages;
create policy "messages_insert_team" on public.messages
  for insert with check (
    public.is_team_member(team_id) and user_id = auth.uid()
    and (
      (message_type = 'text' and attachment_path is null)
      or (message_type = 'image' and attachment_path like team_id::text || '/' || auth.uid()::text || '/%')
    )
  );

drop policy if exists "messages_update_own" on public.messages;
create policy "messages_update_own" on public.messages
  for update using (user_id = auth.uid() and message_type <> 'system')
  with check (
    user_id = auth.uid() and public.is_team_member(team_id)
    and (
      (message_type = 'text' and attachment_path is null)
      or (message_type = 'image' and attachment_path like team_id::text || '/' || auth.uid()::text || '/%')
    )
  );

-- ---------------------------------------------------------------------------
-- Unread count: only HUMAN messages from others count. System events never
-- increment the badge.
-- ---------------------------------------------------------------------------
create or replace function public.get_unread_chat_count(p_team_id uuid)
returns bigint
language plpgsql
security invoker
stable
set search_path = public
as $$
declare
  v_since timestamptz;
begin
  if not public.is_team_member(p_team_id) then
    raise exception 'not_a_team_member' using errcode = '42501';
  end if;

  select coalesce(
    (select last_read_at from public.team_message_read_state where user_id = auth.uid() and team_id = p_team_id),
    (select joined_at from public.team_members where user_id = auth.uid() and team_id = p_team_id),
    'epoch'::timestamptz
  ) into v_since;

  return (
    select count(*)::bigint
    from public.messages m
    where m.team_id = p_team_id
      and m.user_id <> auth.uid()
      and m.message_type <> 'system'
      and m.deleted_at is null
      and m.created_at > v_since
  );
end;
$$;

grant execute on function public.get_unread_chat_count(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- System events. Respects privacy_settings.activity_feed_opt_in and never
-- carries weight / measurements / health data — only the workout title,
-- rounded duration, or challenge title.
-- ---------------------------------------------------------------------------
create or replace function public.post_team_system_event(
  p_team_id uuid, p_user_id uuid, p_event_type text, p_content text, p_metadata jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opt boolean;
begin
  if p_team_id is null or p_user_id is null then return; end if;

  select activity_feed_opt_in into v_opt from public.privacy_settings where user_id = p_user_id;
  if not coalesce(v_opt, true) then return; end if;

  if not exists (select 1 from public.team_members where team_id = p_team_id and user_id = p_user_id) then
    return;
  end if;

  insert into public.messages (team_id, user_id, content, message_type, event_type, metadata)
  values (p_team_id, p_user_id, p_content, 'system', p_event_type, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

revoke all on function public.post_team_system_event(uuid, uuid, text, text, jsonb) from public, anon, authenticated;

create or replace function public.handle_workout_chat_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week_start date;
  v_done int;
  v_goal int;
  v_title text;
begin
  if new.team_id is null then return new; end if;
  v_title := nullif(btrim(coalesce(new.title, '')), '');

  if new.status = 'laeuft' then
    if tg_op = 'UPDATE' then
      if old.status = 'laeuft' then return new; end if;
    end if;
    perform public.post_team_system_event(
      new.team_id, new.user_id, 'workout_started', 'hat ein Training gestartet',
      jsonb_build_object('title', v_title, 'activity_type', new.activity_type)
    );
  end if;

  if tg_op = 'UPDATE' and new.status = 'abgeschlossen' and old.status is distinct from 'abgeschlossen' then
    perform public.post_team_system_event(
      new.team_id, new.user_id, 'workout_completed', 'hat ein Training abgeschlossen',
      jsonb_build_object(
        'title', v_title, 'activity_type', new.activity_type,
        'duration_minutes', round(coalesce(new.duration_seconds, 0) / 60.0)
      )
    );

    v_week_start := date_trunc('week', coalesce(new.finished_at, now()))::date;
    select count(*) into v_done from public.workouts
      where user_id = new.user_id and status = 'abgeschlossen'
        and finished_at >= v_week_start and finished_at < v_week_start + interval '7 days';
    select weekly_goal into v_goal from public.profiles where id = new.user_id;

    if v_done = coalesce(v_goal, 3) then
      perform public.post_team_system_event(
        new.team_id, new.user_id, 'weekly_goal_reached', 'hat das Wochenziel erreicht', '{}'::jsonb
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists on_workout_chat_events on public.workouts;
create trigger on_workout_chat_events
  after insert or update of status on public.workouts
  for each row execute function public.handle_workout_chat_events();

create or replace function public.handle_challenge_chat_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team uuid;
  v_title text;
begin
  if new.completed_at is null or old.completed_at is not null then return new; end if;
  select team_id, title into v_team, v_title from public.challenges where id = new.challenge_id;
  perform public.post_team_system_event(
    v_team, new.user_id, 'challenge_completed', 'hat eine Herausforderung abgeschlossen',
    jsonb_build_object('title', v_title)
  );
  return new;
end;
$$;

drop trigger if exists on_challenge_chat_event on public.challenge_participants;
create trigger on_challenge_chat_event
  after update of completed_at on public.challenge_participants
  for each row execute function public.handle_challenge_chat_event();

-- ---------------------------------------------------------------------------
-- Storage: private chat-media bucket. Path: <team_id>/<user_id>/<file>.
-- Only current members of that team may read; only the owner (and only into a
-- team they belong to) may write/delete.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', false, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png'];

drop policy if exists "chat_media_member_read" on storage.objects;
create policy "chat_media_member_read" on storage.objects
  for select using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and public.is_team_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "chat_media_member_insert" on storage.objects;
create policy "chat_media_member_insert" on storage.objects
  for insert with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[2] = auth.uid()::text
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and public.is_team_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "chat_media_owner_delete" on storage.objects;
create policy "chat_media_owner_delete" on storage.objects
  for delete using (
    bucket_id = 'chat-media' and (storage.foldername(name))[2] = auth.uid()::text
  );
