/** Pure push-gating helpers — quiet hours and motivation pause. Kept out of
 * `server/push-gate.ts` (which is `server-only`, since it reads
 * `notification_preferences` from the DB) so these stay plain-import
 * unit-testable, matching how `ranking.ts` relates to `data/team.ts`. */

import { APP_TIMEZONE } from '@/lib/date';

/** True while a motivation pause is still in effect. A past or null
 * `pausedUntil` auto-resumes — no explicit "unpause" action is required. */
export function isMotivationPaused(pausedUntil: string | null, now: Date = new Date()): boolean {
  return !!pausedUntil && new Date(pausedUntil).getTime() > now.getTime();
}

/** `start`/`end` are "HH:MM" (or "HH:MM:SS") wall-clock strings, or null when
 * quiet hours aren't configured. Supports an overnight window (e.g.
 * 22:00–07:00, where `end` is numerically before `start`) by wrapping
 * instead of treating it as empty. An equal start/end is treated as "not
 * configured" rather than either "always quiet" or "never quiet". */
export function isWithinQuietHours(now: Date, start: string | null, end: string | null, timeZone: string = APP_TIMEZONE): boolean {
  if (!start || !end) return false;
  const s = start.slice(0, 5);
  const e = end.slice(0, 5);
  if (s === e) return false;
  const nowHHMM = now.toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
  return s < e ? nowHHMM >= s && nowHHMM < e : nowHHMM >= s || nowHHMM < e;
}
