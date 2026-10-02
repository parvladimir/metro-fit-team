-- ---------------------------------------------------------------------------
-- Two new notification categories for friendly duels and joint trainings.
--
--   duelle                 a duel invitation addressed to you / your invitation
--                          being accepted
--   gemeinsame_trainings   a "Wer ist dabei?" training invitation in the team
--                          chat, and a substantial change to one you answered
--
-- Unlike the nine existing categories (all default ON), both are strictly
-- opt-in: they default to FALSE for every existing profile and every profile
-- created later, so nobody receives a duel or joint-training push without
-- having switched it on themselves. The default is a constant, so Postgres
-- adds the columns without rewriting the table and no existing row's other
-- values change. Same add-column-if-not-exists idiom as 0020/0031/0034/0044.
--
-- No RLS change: notification_preferences is already owner-only (select /
-- update / insert on user_id = auth.uid()), and new columns inherit that.
-- ---------------------------------------------------------------------------
alter table public.notification_preferences
  add column if not exists duelle boolean not null default false,
  add column if not exists gemeinsame_trainings boolean not null default false;
