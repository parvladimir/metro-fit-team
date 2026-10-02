import { describe, expect, it } from 'vitest';
import {
  isoWeekday,
  startOfWeek,
  percentChange,
  formatChatDayLabel,
  isSameLocalDay,
  setLocalTimeOfDay,
  localTimeString,
  localDateTimeToUtc,
  toLocalDateTimeInputValue,
  berlinDayRange,
  berlinWeekRange,
  berlinPreviousWeekRange,
  addDaysToKey,
  formatDayKeyShort,
  resolveLocalDateTime,
} from './date';

describe('isoWeekday', () => {
  it('maps Sunday to 7, not 0', () => {
    expect(isoWeekday(new Date('2024-01-07T12:00:00Z'))).toBe(7); // a Sunday
  });

  it('maps Monday to 1', () => {
    expect(isoWeekday(new Date('2024-01-08T12:00:00Z'))).toBe(1); // a Monday
  });
});

describe('startOfWeek', () => {
  it('returns the Monday of the given week at midnight', () => {
    const wednesday = new Date('2024-01-10T15:30:00');
    const monday = startOfWeek(wednesday);
    expect(monday.getDay()).toBe(1);
    expect(monday.getHours()).toBe(0);
    expect(monday.getMinutes()).toBe(0);
  });
});

describe('percentChange', () => {
  it('computes a positive percentage increase', () => {
    expect(percentChange(120, 100)).toBe(20);
  });

  it('computes a negative percentage decrease', () => {
    expect(percentChange(80, 100)).toBe(-20);
  });

  it('treats going from 0 to a positive value as +100%', () => {
    expect(percentChange(5, 0)).toBe(100);
  });

  it('returns null when there is no prior data and no current data', () => {
    expect(percentChange(0, 0)).toBeNull();
  });
});

describe('formatChatDayLabel', () => {
  const now = new Date('2024-01-10T15:00:00Z'); // a Wednesday

  it('labels the same calendar day as Heute', () => {
    expect(formatChatDayLabel(new Date('2024-01-10T08:00:00Z'), now)).toBe('Heute');
  });

  it('labels the previous calendar day as Gestern', () => {
    expect(formatChatDayLabel(new Date('2024-01-09T20:00:00Z'), now)).toBe('Gestern');
  });

  it('labels an older date with abbreviated weekday and full date', () => {
    // 2024-01-08 is a Monday (see isoWeekday test above).
    expect(formatChatDayLabel(new Date('2024-01-08T12:00:00Z'), now)).toBe('Mo., 08.01.2024');
  });

  it('resolves the calendar day in the app timezone, not raw UTC', () => {
    // 23:30 UTC on Jan 9 is already 00:30 on Jan 10 in Europe/Berlin (UTC+1 in
    // winter) — a UTC-only comparison would wrongly call this "Gestern".
    const lateUtcButAlreadyTomorrowInBerlin = new Date('2024-01-09T23:30:00Z');
    const berlinNow = new Date('2024-01-10T10:00:00Z');
    expect(formatChatDayLabel(lateUtcButAlreadyTomorrowInBerlin, berlinNow)).toBe('Heute');
  });
});

describe('isSameLocalDay', () => {
  it('treats two timestamps on the same Berlin calendar day as equal, across a UTC midnight', () => {
    expect(isSameLocalDay(new Date('2024-01-09T23:30:00Z'), new Date('2024-01-10T10:00:00Z'))).toBe(true);
  });
  it('treats two timestamps on different Berlin calendar days as different', () => {
    expect(isSameLocalDay(new Date('2024-01-09T10:00:00Z'), new Date('2024-01-10T10:00:00Z'))).toBe(false);
  });
});

describe('setLocalTimeOfDay', () => {
  it('keeps the reference Berlin calendar day and applies the new time, accounting for winter (CET, +1)', () => {
    const result = setLocalTimeOfDay(new Date('2024-01-10T10:00:00Z'), '14:30')!;
    expect(result.toISOString()).toBe('2024-01-10T13:30:00.000Z');
  });

  it('accounts for summer (CEST, +2)', () => {
    const result = setLocalTimeOfDay(new Date('2024-07-10T10:00:00Z'), '14:30')!;
    expect(result.toISOString()).toBe('2024-07-10T12:30:00.000Z');
  });

  it('rejects a malformed time instead of guessing', () => {
    expect(setLocalTimeOfDay(new Date('2024-01-10T10:00:00Z'), 'not-a-time')).toBeNull();
    expect(setLocalTimeOfDay(new Date('2024-01-10T10:00:00Z'), '25:00')).toBeNull();
  });

  it('round-trips through localTimeString', () => {
    const result = setLocalTimeOfDay(new Date('2024-01-10T10:00:00Z'), '09:05')!;
    expect(localTimeString(result)).toBe('09:05');
  });
});

describe('localDateTimeToUtc', () => {
  it('interprets a datetime-local value as Berlin wall-clock time (CEST, +2)', () => {
    // 1 Oct 2026 00:00 Berlin — still daylight saving (ends last Sunday of October).
    const result = localDateTimeToUtc('2026-10-01T00:00')!;
    expect(result.toISOString()).toBe('2026-09-30T22:00:00.000Z');
  });

  it('accounts for winter (CET, +1)', () => {
    const result = localDateTimeToUtc('2026-01-15T09:30')!;
    expect(result.toISOString()).toBe('2026-01-15T08:30:00.000Z');
  });

  it('rejects a malformed value instead of guessing', () => {
    expect(localDateTimeToUtc('not-a-date')).toBeNull();
    expect(localDateTimeToUtc('2026-10-01')).toBeNull();
    expect(localDateTimeToUtc('2026-10-01T25:00')).toBeNull();
  });

  it('round-trips through toLocalDateTimeInputValue', () => {
    const value = '2026-10-01T00:00';
    expect(toLocalDateTimeInputValue(localDateTimeToUtc(value)!)).toBe(value);
  });
});

describe('berlinDayRange', () => {
  it('spans 25 hours on the CEST->CET fall-back day (2026-10-25)', () => {
    const { start, end } = berlinDayRange(0, new Date('2026-10-25T12:00:00Z'));
    expect(start.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(25 * 3600 * 1000);
  });

  it('spans 23 hours on the CET->CEST spring-forward day (2026-03-29)', () => {
    const { start, end } = berlinDayRange(0, new Date('2026-03-29T12:00:00Z'));
    expect(start.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(23 * 3600 * 1000);
  });

  it('dayOffset=-1 ("Gestern") correctly resolves a transition day from the day after it', () => {
    const { start, end } = berlinDayRange(-1, new Date('2026-03-30T12:00:00Z'));
    expect(start.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-29T22:00:00.000Z');
  });

  it('is an ordinary 24h span on a non-transition day', () => {
    const { start, end } = berlinDayRange(0, new Date('2026-01-15T12:00:00Z'));
    expect(start.toISOString()).toBe('2026-01-14T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-01-15T23:00:00.000Z');
  });
});

describe('berlinWeekRange', () => {
  it('computes Monday 00:00 Berlin to next Monday 00:00 Berlin', () => {
    const { start, end } = berlinWeekRange(new Date('2026-10-28T10:00:00Z')); // Wednesday, week of Mon Oct 26 - Sun Nov 1
    expect(start.toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-01T23:00:00.000Z');
  });

  it('spans an extra hour for the week containing the fall-back transition', () => {
    const { start, end } = berlinWeekRange(new Date('2026-10-21T10:00:00Z')); // Wednesday, week of Mon Oct 19 - Sun Oct 25 (transition day)
    expect(start.toISOString()).toBe('2026-10-18T22:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(7 * 24 * 3600 * 1000 + 3600 * 1000);
  });
});

describe('berlinPreviousWeekRange', () => {
  it('derives the fully-elapsed week immediately before the one containing `now`', () => {
    // now = Wed Oct 28 (week of Mon Oct26-Sun Nov1); previous week = Mon
    // Oct19-Sun Oct25, the same fall-back transition week tested directly
    // above via berlinWeekRange — must match it exactly.
    const { start, end } = berlinPreviousWeekRange(new Date('2026-10-28T10:00:00Z'));
    expect(start.toISOString()).toBe('2026-10-18T22:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });

  it('correctly derives a previous week that itself contains the spring-forward transition', () => {
    // now = Wed Apr 1 (week of Mon Mar30-Sun Apr5); previous week = Mon
    // Mar23-Sun Mar29, containing the Mar29 CET->CEST transition (23h short).
    const { start, end } = berlinPreviousWeekRange(new Date('2026-04-01T10:00:00Z'));
    expect(start.toISOString()).toBe('2026-03-22T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(7 * 24 * 3600 * 1000 - 3600 * 1000);
  });
});

describe('addDaysToKey', () => {
  it('adds and subtracts calendar days across month, year and leap-day boundaries', () => {
    expect(addDaysToKey('2026-10-02', 7)).toBe('2026-10-09');
    expect(addDaysToKey('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDaysToKey('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDaysToKey('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysToKey('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDaysToKey('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('is unaffected by daylight-saving changes (pure date arithmetic)', () => {
    expect(addDaysToKey('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDaysToKey('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDaysToKey('2026-10-24', 2)).toBe('2026-10-26');
  });
});

describe('resolveLocalDateTime', () => {
  const iso = (d: Date) => d.toISOString();

  it('resolves an ordinary summer and winter time to exactly one instant', () => {
    const summer = resolveLocalDateTime('2026-07-15T18:30');
    expect(summer.kind).toBe('ok');
    expect(summer.kind === 'ok' && iso(summer.instant)).toBe('2026-07-15T16:30:00.000Z'); // CEST, +2
    const winter = resolveLocalDateTime('2026-01-15T18:30');
    expect(winter.kind === 'ok' && iso(winter.instant)).toBe('2026-01-15T17:30:00.000Z'); // CET, +1
  });

  it('flags a spring-forward gap (2026-03-29, 02:00-02:59 does not exist in Berlin) with both nearest real readings', () => {
    for (const time of ['02:00', '02:30', '02:59']) {
      const r = resolveLocalDateTime(`2026-03-29T${time}`);
      expect(r.kind, time).toBe('gap');
    }
    const r = resolveLocalDateTime('2026-03-29T02:30');
    if (r.kind !== 'gap') throw new Error('expected a gap');
    expect(iso(r.before)).toBe('2026-03-29T00:30:00.000Z'); // displays 01:30 CET
    expect(iso(r.after)).toBe('2026-03-29T01:30:00.000Z'); // displays 03:30 CEST
    expect(toLocalDateTimeInputValue(r.before)).toBe('2026-03-29T01:30');
    expect(toLocalDateTimeInputValue(r.after)).toBe('2026-03-29T03:30');
  });

  it('treats the minutes either side of the spring gap as ordinary', () => {
    const before = resolveLocalDateTime('2026-03-29T01:59');
    expect(before.kind === 'ok' && iso(before.instant)).toBe('2026-03-29T00:59:00.000Z');
    const after = resolveLocalDateTime('2026-03-29T03:00');
    expect(after.kind === 'ok' && iso(after.instant)).toBe('2026-03-29T01:00:00.000Z');
  });

  it('flags a fall-back overlap (2026-10-25, 02:00-02:59 happens twice in Berlin) with both instants, earlier first', () => {
    for (const time of ['02:00', '02:30', '02:59']) {
      const r = resolveLocalDateTime(`2026-10-25T${time}`);
      expect(r.kind, time).toBe('ambiguous');
    }
    const r = resolveLocalDateTime('2026-10-25T02:30');
    if (r.kind !== 'ambiguous') throw new Error('expected an overlap');
    expect(iso(r.first)).toBe('2026-10-25T00:30:00.000Z'); // CEST (MESZ)
    expect(iso(r.second)).toBe('2026-10-25T01:30:00.000Z'); // CET (MEZ)
    expect(toLocalDateTimeInputValue(r.first)).toBe('2026-10-25T02:30');
    expect(toLocalDateTimeInputValue(r.second)).toBe('2026-10-25T02:30');
  });

  it('treats the minutes either side of the autumn overlap as ordinary', () => {
    const before = resolveLocalDateTime('2026-10-25T01:59');
    expect(before.kind === 'ok' && iso(before.instant)).toBe('2026-10-24T23:59:00.000Z');
    const after = resolveLocalDateTime('2026-10-25T03:00');
    expect(after.kind === 'ok' && iso(after.instant)).toBe('2026-10-25T02:00:00.000Z');
  });

  it('applies the same rules in other years (last Sunday of March / October)', () => {
    expect(resolveLocalDateTime('2027-03-28T02:30').kind).toBe('gap');
    expect(resolveLocalDateTime('2027-10-31T02:30').kind).toBe('ambiguous');
    // The Sunday a week before each transition is an ordinary day.
    expect(resolveLocalDateTime('2027-03-21T02:30').kind).toBe('ok');
    expect(resolveLocalDateTime('2027-10-24T02:30').kind).toBe('ok');
  });

  it('is ordinary on the transition days at times far from the transition', () => {
    for (const value of ['2026-03-29T00:00', '2026-03-29T12:00', '2026-03-29T23:59', '2026-10-25T00:00', '2026-10-25T12:00', '2026-10-25T23:59']) {
      expect(resolveLocalDateTime(value).kind, value).toBe('ok');
    }
  });

  it('agrees with localDateTimeToUtc for every unambiguous value, including around midnight', () => {
    for (const value of ['2026-10-02T00:00', '2026-10-02T23:59', '2026-12-31T23:59', '2027-01-01T00:00', '2026-03-29T12:00', '2026-10-25T12:00']) {
      const r = resolveLocalDateTime(value);
      expect(r.kind, value).toBe('ok');
      expect(r.kind === 'ok' && r.instant.getTime(), value).toBe(localDateTimeToUtc(value)!.getTime());
    }
  });

  it('rejects values that are not a real calendar date/time or not in the expected format', () => {
    for (const value of [
      '2026-02-30T10:00', '2026-04-31T10:00', '2027-02-29T10:00', '2026-13-01T10:00', '2026-00-10T10:00', '2026-10-00T10:00',
      '2026-10-02T24:00', '2026-10-02T10:60', '2026-10-02 10:00', '2026-10-02T10:00:00', '2026-10-02', '10:00', '', 'garbage', '0099-10-02T10:00',
    ]) {
      expect(resolveLocalDateTime(value).kind, value).toBe('invalid');
    }
  });

  it('accepts a leap day and trims surrounding whitespace', () => {
    expect(resolveLocalDateTime('2028-02-29T10:00').kind).toBe('ok');
    expect(resolveLocalDateTime('  2026-10-02T10:00  ').kind).toBe('ok');
  });

  it('regression: localDateTimeToUtc keeps its existing silent resolution of a gap and an overlap', () => {
    // Other features (workout end-time corrections) rely on this; scheduling
    // an event uses resolveLocalDateTime instead and must not change it.
    expect(localDateTimeToUtc('2026-03-29T02:30')!.toISOString()).toBe('2026-03-29T00:30:00.000Z');
    expect(localDateTimeToUtc('2026-10-25T02:30')!.toISOString()).toBe('2026-10-25T01:30:00.000Z');
  });
});

describe('formatDayKeyShort', () => {
  it('gives weekday, day and month — read from the calendar key, not from any time zone', () => {
    expect(formatDayKeyShort('2026-10-03')).toBe('Sa., 03.10.');
    expect(formatDayKeyShort('2026-10-04')).toBe('So., 04.10.');
    expect(formatDayKeyShort('2026-10-05')).toBe('Mo., 05.10.');
    expect(formatDayKeyShort('2027-01-01')).toBe('Fr., 01.01.');
  });
});
