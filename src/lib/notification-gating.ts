/** Pure push-gating helpers — the notification categories, quiet hours, the
 * motivation pause, and the one decision function that combines them. Kept
 * out of `server/push-gate.ts` (which is `server-only`, since it reads
 * `notification_preferences` from the DB) so all of this stays plain-import
 * unit-testable, matching how `ranking.ts` relates to `data/team.ts`. */

import { APP_TIMEZONE } from '@/lib/date';
import type { NotificationPreferences } from '@/types/database';

/** Categories that are ON unless the user switches them off. Array order is
 * the order the settings page lists them in. */
export const DEFAULT_ON_CATEGORIES = [
  'chat_nachrichten',
  'reaktionen_antworten',
  'erwaehnungen',
  'trainingserinnerung',
  'wochenziel',
  'messungserinnerung',
  'herausforderung',
  'team_aktivitaet',
  'wochenzusammenfassung',
] as const;

/** Categories that are OFF until the user switches them on. A push in one of
 * these must never go out on a missing or unreadable preference. */
export const OPT_IN_CATEGORIES = ['duelle', 'gemeinsame_trainings'] as const;

/** Every boolean `notification_preferences` column the settings form writes. */
export const ALL_NOTIFICATION_CATEGORIES = [...DEFAULT_ON_CATEGORIES, ...OPT_IN_CATEGORIES] as const;

export type DefaultOnCategory = (typeof DEFAULT_ON_CATEGORIES)[number];
export type OptInCategory = (typeof OPT_IN_CATEGORIES)[number];
/** Every `notification_preferences` boolean column that gates a push. */
export type PushCategory = DefaultOnCategory | OptInCategory;

type BooleanPreferenceKey = {
  [K in keyof NotificationPreferences]-?: NotificationPreferences[K] extends boolean ? K : never;
}[keyof NotificationPreferences];
type AssertTrue<T extends true> = T;
/** Compile-time guard, both directions: a boolean column added to
 * `NotificationPreferences` without being listed above (the settings form
 * would silently write `false` for it on every save), and a listed category
 * that is not a real boolean column, are both type errors here. */
export type NotificationCategoriesAreExhaustive = AssertTrue<[Exclude<BooleanPreferenceKey, PushCategory>] extends [never] ? true : false>;
export type NotificationCategoriesAreReal = AssertTrue<[Exclude<PushCategory, BooleanPreferenceKey>] extends [never] ? true : false>;

export function isOptInCategory(category: PushCategory): category is OptInCategory {
  return (OPT_IN_CATEGORIES as readonly string[]).includes(category);
}

/** Reminder/digest-style categories — these are what "Motivation pausieren"
 * pauses. Direct social interaction (reactions, replies, mentions, chat
 * messages) is deliberately excluded, per the spec's own "without losing
 * direct replies". Duel and joint-training notifications are direct
 * interaction between named people, so they are excluded too: they stay
 * opt-in and still respect quiet hours, but a motivation pause does not
 * silence an invitation someone sent you. */
export const MOTIVATION_CATEGORIES: ReadonlySet<PushCategory> = new Set<PushCategory>([
  'wochenzusammenfassung',
  'trainingserinnerung',
  'wochenziel',
  'messungserinnerung',
  'herausforderung',
  'team_aktivitaet',
]);

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

/** The columns a gate decision reads, plus the one category column it is
 * asked about (hence the open `Record`). */
export type GatePreferences = {
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  motivation_paused_until: string | null;
} & Record<string, unknown>;

/** The single push-delivery decision: category switch, then quiet hours, then
 * (reminder/digest categories only) the motivation pause.
 *
 * A missing preference row is the rare out-of-band case (every profile gets a
 * default row). The nine default-ON categories fail OPEN there; the opt-in
 * categories fail CLOSED — and also when the column itself is unreadable
 * (code running ahead of its migration), because for them "no answer" must
 * never mean "send". */
export function passesPushGate(pref: GatePreferences | null | undefined, category: PushCategory, now: Date = new Date()): boolean {
  const optIn = isOptInCategory(category);
  if (!pref) return !optIn;
  if (optIn ? pref[category] !== true : pref[category] === false) return false;
  if (isWithinQuietHours(now, pref.quiet_hours_start, pref.quiet_hours_end)) return false;
  if (MOTIVATION_CATEGORIES.has(category) && isMotivationPaused(pref.motivation_paused_until, now)) return false;
  return true;
}
