-- ---------------------------------------------------------------------------
-- Performance: the most common query pattern across the app (dashboard
-- weekly stats, get_weekly_comparison, recompute_challenge_progress,
-- profile streak calculation) filters workouts by
-- `user_id = ? and status = 'abgeschlossen' and finished_at between ? and ?`.
-- There was no index covering `finished_at` at all, so every one of those
-- queries fell back to a sequential scan filtered in memory. This composite
-- index lets Postgres do an index range scan instead.
-- ---------------------------------------------------------------------------
create index workouts_user_status_finished_at_idx
  on public.workouts (user_id, status, finished_at);
