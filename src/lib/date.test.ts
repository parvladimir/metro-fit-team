import { describe, expect, it } from 'vitest';
import { isoWeekday, startOfWeek, percentChange } from './date';

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
