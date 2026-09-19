-- Message editing / soft delete. RLS (messages_update_own) already limits UPDATE
-- to the sender's own non-system messages; this trigger additionally pins every
-- field except `content` and `deleted_at`, stamps `edited_at`, and forbids
-- un-deleting. It never touches created_at, so unread counts are unaffected, and
-- notification triggers only fire on INSERT, so an edit notifies nobody.
create or replace function public.guard_message_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Trusted server contexts (service role / definer functions) carry no user.
  if auth.uid() is null then return new; end if;

  if old.message_type = 'system' then
    raise exception 'system_message_not_editable' using errcode = '42501';
  end if;

  if new.user_id is distinct from old.user_id
     or new.team_id is distinct from old.team_id
     or new.message_type is distinct from old.message_type
     or new.parent_message_id is distinct from old.parent_message_id
     or new.reply_to_id is distinct from old.reply_to_id
     or new.event_type is distinct from old.event_type
     or new.created_at is distinct from old.created_at
     or new.attachment_path is distinct from old.attachment_path
     or new.attachment_mime is distinct from old.attachment_mime
     or new.attachment_width is distinct from old.attachment_width
     or new.attachment_height is distinct from old.attachment_height
     or new.metadata is distinct from old.metadata then
    raise exception 'immutable_message_field' using errcode = '42501';
  end if;

  if old.deleted_at is not null then
    raise exception 'message_deleted' using errcode = '42501';
  end if;

  if new.content is distinct from old.content then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;
  return new;
end;
$$;

drop trigger if exists on_message_update_guard on public.messages;
create trigger on_message_update_guard
  before update on public.messages
  for each row execute function public.guard_message_update();
