-- ---------------------------------------------------------------------------
-- Quiet hours + motivation pause: two new, independent, opt-in controls on
-- the existing notification_preferences row. All three nullable, default
-- null = "not configured" — no existing user's behavior changes until they
-- touch these fields. Same add-column-if-not-exists idiom as
-- 0020/0031/0034, except these default to "off" rather than "on": they are
-- new opt-in behaviors, not new always-on notification categories.
-- ---------------------------------------------------------------------------
alter table public.notification_preferences
  add column if not exists quiet_hours_start time,
  add column if not exists quiet_hours_end time,
  add column if not exists motivation_paused_until timestamptz;
