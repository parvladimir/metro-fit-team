-- ---------------------------------------------------------------------------
-- Add a dedicated "Chat-Nachrichten" toggle to the existing notification
-- preferences row rather than inventing a separate preferences system —
-- this is what gates whether a team chat message triggers a Web Push
-- notification to a given user (see 0022_push_subscriptions.sql).
-- ---------------------------------------------------------------------------
alter table public.notification_preferences
  add column if not exists chat_nachrichten boolean not null default true;
