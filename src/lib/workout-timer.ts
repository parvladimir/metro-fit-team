/** Centralized forgotten-timer thresholds — product defaults, not medical
 * limits or an assertion that longer workouts are impossible. Adjust here.
 *
 * The 180-minute confirmation threshold is also enforced server-side (as
 * 10800 seconds) in supabase/migrations/0037_workout_pause_and_review_safety.sql
 * (finish_own_workout, update_own_workout, guard_workout_update) — PL/pgSQL
 * can't import this constant, so that duplication is unavoidable. Keep both
 * in sync if this value ever changes. */
export const LONG_WORKOUT_REMINDER_MINUTES = 120;
export const LONG_WORKOUT_CONFIRM_MINUTES = 180;

export function isLongWorkout(elapsedSeconds: number): boolean {
  return elapsedSeconds >= LONG_WORKOUT_CONFIRM_MINUTES * 60;
}

export function needsGentleReminder(elapsedSeconds: number): boolean {
  return elapsedSeconds >= LONG_WORKOUT_REMINDER_MINUTES * 60;
}

/** Elapsed recorded time right now: wall-clock since start, minus completed
 * pauses, minus the currently-open pause interval if any. Never an
 * accumulated client counter — always re-derived from persisted timestamps,
 * so a reload or backgrounded app can't lose or invent elapsed time. */
export function computeElapsedSeconds(params: {
  startedAt: string;
  pausedSeconds: number;
  pausedAt: string | null;
  now?: Date;
}): number {
  const now = params.now ?? new Date();
  const started = new Date(params.startedAt).getTime();
  const openPause = params.pausedAt ? Math.max(0, (now.getTime() - new Date(params.pausedAt).getTime()) / 1000) : 0;
  const elapsed = (now.getTime() - started) / 1000 - params.pausedSeconds - openPause;
  return Math.max(0, Math.round(elapsed));
}
