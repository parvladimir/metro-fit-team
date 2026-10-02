/** ISO weekday: 1 = Montag ... 7 = Sonntag (matches workout_plan_days.weekday). */
export function isoWeekday(date: Date = new Date()): number {
  const day = date.getDay(); // 0 = Sunday
  return day === 0 ? 7 : day;
}

export function startOfWeek(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const diff = isoWeekday(d) - 1;
  d.setDate(d.getDate() - diff);
  return d;
}

export function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatGermanDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatGermanDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

/** The team's effective timezone. No per-user/team preference exists in the
 * schema today — this is the single shared source for what used to be 3
 * independently hardcoded 'Europe/Berlin' literals (set-input.ts, coach.ts,
 * data/coach.ts). */
export const APP_TIMEZONE = 'Europe/Berlin';

const WEEKDAY_ABBR_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']; // index = Date#getUTCDay(), 0 = Sunday

/** Calendar date (YYYY-MM-DD) of a timestamp in the given timezone. */
export function localDayKey(d: Date, timeZone: string = APP_TIMEZONE): string {
  return d.toLocaleDateString('sv-SE', { timeZone });
}

export function isSameLocalDay(a: Date, b: Date, timeZone: string = APP_TIMEZONE): boolean {
  return localDayKey(a, timeZone) === localDayKey(b, timeZone);
}

/** Chat date-separator label: "Heute" / "Gestern" / "Fr., 25.09.2026". Always
 * timezone-explicit — unlike formatGermanDate above (no `timeZone` option,
 * pre-existing, can show the wrong calendar day near midnight on a UTC
 * server), this new helper doesn't repeat that. */
export function formatChatDayLabel(date: Date, now: Date = new Date(), timeZone: string = APP_TIMEZONE): string {
  const dayKey = localDayKey(date, timeZone);
  if (dayKey === localDayKey(now, timeZone)) return 'Heute';
  if (dayKey === localDayKey(new Date(now.getTime() - 24 * 3600 * 1000), timeZone)) return 'Gestern';
  const weekday = WEEKDAY_ABBR_DE[new Date(`${dayKey}T00:00:00Z`).getUTCDay()];
  const [y, m, day] = dayKey.split('-');
  return `${weekday}., ${day}.${m}.${y}`;
}

/** HH:MM wall-clock time of a timestamp in the given timezone (for pre-filling
 * a same-day time-correction input). */
export function localTimeString(d: Date, timeZone: string = APP_TIMEZONE): string {
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
}

/** UTC instant for "the same calendar day as `reference`, but at `hhmm`
 * wall-clock time in `timeZone`". Used for a same-day end-time correction
 * (e.g. the workout review screen) without needing a full date+time picker.
 * Returns null for a malformed hhmm. */
export function setLocalTimeOfDay(reference: Date, hhmm: string, timeZone: string = APP_TIMEZONE): Date | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;

  const dayKey = localDayKey(reference, timeZone);
  const [y, m, day] = dayKey.split('-').map(Number);
  // Guess the UTC instant by reading the desired wall-clock time as if it
  // were already UTC, then correct by that guess's actual offset in `timeZone`.
  const guess = new Date(Date.UTC(y!, m! - 1, day!, hour, minute));
  const offsetMinutes = timeZoneOffsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - offsetMinutes * 60000);
}

/** The reverse of `localDateTimeToUtc`: a "YYYY-MM-DDTHH:MM" wall-clock
 * value in `timeZone`, for pre-filling a `datetime-local` input from a
 * stored UTC instant. */
export function toLocalDateTimeInputValue(d: Date, timeZone: string = APP_TIMEZONE): string {
  return `${localDayKey(d, timeZone)}T${localTimeString(d, timeZone)}`;
}

/** UTC instant for a "YYYY-MM-DDTHH:MM" wall-clock value (the format a
 * native `datetime-local` input produces) in `timeZone`. Used to interpret
 * an admin-entered local date/time as a real instant, independent of the
 * browser's own timezone. Returns null for a malformed value. */
export function localDateTimeToUtc(value: string, timeZone: string = APP_TIMEZONE): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (hour! > 23 || minute! > 59) return null;
  const guess = new Date(Date.UTC(year!, month! - 1, day!, hour, minute));
  const offsetMinutes = timeZoneOffsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - offsetMinutes * 60000);
}

/** What a "YYYY-MM-DDTHH:MM" wall-clock value means in a time zone.
 *
 * - `ok`        exactly one instant has that wall-clock reading.
 * - `ambiguous` the clocks go back and the reading occurs twice (Berlin:
 *               02:00–02:59 on the last Sunday of October). `first` is the
 *               earlier instant (summer time), `second` the later (winter time).
 * - `gap`       the clocks jump forward and the reading never occurs (Berlin:
 *               02:00–02:59 on the last Sunday of March). `before` is the
 *               instant the reading would be if the clocks had not yet jumped
 *               (it displays an hour earlier), `after` the one if they already
 *               had (it displays an hour later) — the two nearest real times.
 * - `invalid`   not a real calendar date/time, or not in the expected format.
 */
export type LocalDateTimeResolution =
  | { kind: 'ok'; instant: Date }
  | { kind: 'ambiguous'; first: Date; second: Date }
  | { kind: 'gap'; before: Date; after: Date }
  | { kind: 'invalid' };

/** The stricter sibling of `localDateTimeToUtc`: that one silently picks an
 * answer for a DST gap or overlap, which is right for end-of-workout
 * corrections but wrong when someone schedules a future event and would
 * otherwise get a time they never typed. This reports the situation so the
 * caller can ask. A value that is neither in a gap nor an overlap resolves to
 * exactly what `localDateTimeToUtc` returns for it. */
export function resolveLocalDateTime(value: string, timeZone: string = APP_TIMEZONE): LocalDateTimeResolution {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return { kind: 'invalid' };
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  if (year < 1000 || hour > 23 || minute > 59) return { kind: 'invalid' };
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) {
    return { kind: 'invalid' };
  }

  // The wall-clock reading as if it were UTC, then each UTC offset the zone
  // uses within a day either side of it: a candidate instant is real only if
  // the zone actually has that offset at that instant.
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const DAY_MS = 24 * 60 * 60 * 1000;
  const offsets = new Set([
    timeZoneOffsetMinutes(new Date(wall - DAY_MS), timeZone),
    timeZoneOffsetMinutes(new Date(wall + DAY_MS), timeZone),
  ]);
  const instants = [...offsets]
    .map((offset) => ({ offset, instant: new Date(wall - offset * 60000) }))
    .filter(({ offset, instant }) => timeZoneOffsetMinutes(instant, timeZone) === offset)
    .map(({ instant }) => instant)
    .sort((a, b) => a.getTime() - b.getTime());

  if (instants.length === 1) return { kind: 'ok', instant: instants[0]! };
  if (instants.length === 2) return { kind: 'ambiguous', first: instants[0]!, second: instants[1]! };

  // A gap: no candidate round-trips. Offer the two readings the value could
  // have meant (before / after the clocks jumped).
  const [a, b] = [...offsets].map((offset) => new Date(wall - offset * 60000)).sort((x, y) => x.getTime() - y.getTime());
  return { kind: 'gap', before: a!, after: b! };
}

/** Calendar-date arithmetic on a YYYY-MM-DD key (pure date math, no time zone
 * involved — adding days to a date key is the same in every zone). */
export function addDaysToKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

function isoWeekdayFromKey(dayKey: string): number {
  const day = new Date(`${dayKey}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return day === 0 ? 7 : day;
}

/** [start, end) UTC instants for one Berlin-local calendar day — each
 * boundary converted independently via the DST-aware `localDateTimeToUtc`,
 * so a 23h/25h DST-transition day still gets its real midnight-to-midnight
 * span, not a fixed 24h added to `start`. `dayOffset`: 0 = today, -1 =
 * yesterday. */
export function berlinDayRange(dayOffset = 0, now: Date = new Date(), timeZone: string = APP_TIMEZONE): { start: Date; end: Date } {
  const dayKey = addDaysToKey(localDayKey(now, timeZone), dayOffset);
  const nextDayKey = addDaysToKey(dayKey, 1);
  return {
    start: localDateTimeToUtc(`${dayKey}T00:00`, timeZone)!,
    end: localDateTimeToUtc(`${nextDayKey}T00:00`, timeZone)!,
  };
}

/** [start, end) UTC instants for the current Berlin-local ISO week (Monday
 * 00:00 to next Monday 00:00). Deliberately not built on the existing
 * `startOfWeek()`, which uses the server runtime's own local time rather
 * than Berlin — the day-of-week itself is derived from the Berlin calendar
 * key, not from `Date#getDay()`, so this stays correct close to midnight on
 * a UTC server regardless of the host's own timezone. */
export function berlinWeekRange(now: Date = new Date(), timeZone: string = APP_TIMEZONE): { start: Date; end: Date } {
  const todayKey = localDayKey(now, timeZone);
  const mondayKey = addDaysToKey(todayKey, -(isoWeekdayFromKey(todayKey) - 1));
  return {
    start: localDateTimeToUtc(`${mondayKey}T00:00`, timeZone)!,
    end: localDateTimeToUtc(`${addDaysToKey(mondayKey, 7)}T00:00`, timeZone)!,
  };
}

/** [start, end) UTC instants for the Berlin-local ISO week immediately
 * before the one containing `now` — the most recently fully-elapsed
 * team-local week. Subtracting one day from this week's Monday 00:00 always
 * lands within the previous Sunday regardless of DST (a transition shifts
 * that instant by at most ±1h, nowhere near crossing into Saturday or
 * Monday), so re-running `berlinWeekRange` on that instant safely re-derives
 * the full previous week. A recap built from this range can never appear
 * before its week has ended — there's no separate "has the week ended yet"
 * check to get wrong. */
export function berlinPreviousWeekRange(now: Date = new Date(), timeZone: string = APP_TIMEZONE): { start: Date; end: Date } {
  const current = berlinWeekRange(now, timeZone);
  return berlinWeekRange(new Date(current.start.getTime() - 24 * 60 * 60 * 1000), timeZone);
}

function timeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const wallClockAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return (wallClockAsUtc - instant.getTime()) / 60000;
}
