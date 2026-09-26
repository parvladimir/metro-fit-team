import { describe, expect, it } from 'vitest';
import { isoWeekday, startOfWeek, percentChange, formatChatDayLabel, isSameLocalDay, setLocalTimeOfDay, localTimeString } from './date';

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
