import { describe, expect, it } from 'vitest';
import { isMotivationPaused, isWithinQuietHours } from './notification-gating';

describe('isMotivationPaused', () => {
  const now = new Date('2026-10-02T12:00:00Z');

  it('is false when null (not configured)', () => {
    expect(isMotivationPaused(null, now)).toBe(false);
  });

  it('is true while the resume instant is still in the future', () => {
    expect(isMotivationPaused('2026-10-05T00:00:00Z', now)).toBe(true);
  });

  it('is false once the resume instant has passed — auto-resumes, no explicit unpause needed', () => {
    expect(isMotivationPaused('2026-09-30T00:00:00Z', now)).toBe(false);
  });
});

describe('isWithinQuietHours', () => {
  it('is false when not configured (either bound null)', () => {
    expect(isWithinQuietHours(new Date('2026-10-02T23:00:00Z'), null, '07:00')).toBe(false);
    expect(isWithinQuietHours(new Date('2026-10-02T23:00:00Z'), '22:00', null)).toBe(false);
  });

  it('is false when start equals end (treated as not configured, not "always quiet")', () => {
    expect(isWithinQuietHours(new Date('2026-10-02T23:00:00Z'), '08:00', '08:00')).toBe(false);
  });

  it('handles an ordinary same-day window', () => {
    // 12:00-14:00 Berlin (CEST, +2 on Oct 2, before the Oct 25 transition).
    expect(isWithinQuietHours(new Date('2026-10-02T09:00:00Z'), '12:00', '14:00')).toBe(false); // 11:00 Berlin, before
    expect(isWithinQuietHours(new Date('2026-10-02T11:00:00Z'), '12:00', '14:00')).toBe(true); // 13:00 Berlin, inside
    expect(isWithinQuietHours(new Date('2026-10-02T13:00:00Z'), '12:00', '14:00')).toBe(false); // 15:00 Berlin, after
  });

  it('handles an overnight-wrapping window (22:00-07:00)', () => {
    const start = '22:00';
    const end = '07:00';
    // 23:00 Berlin (CEST, +2) = 21:00 UTC -> inside
    expect(isWithinQuietHours(new Date('2026-10-02T21:00:00Z'), start, end)).toBe(true);
    // 02:00 Berlin = 00:00 UTC -> inside (wrapped past midnight)
    expect(isWithinQuietHours(new Date('2026-10-02T00:00:00Z'), start, end)).toBe(true);
    // 12:00 Berlin = 10:00 UTC -> outside
    expect(isWithinQuietHours(new Date('2026-10-02T10:00:00Z'), start, end)).toBe(false);
    // exactly the start boundary -> inside
    expect(isWithinQuietHours(new Date('2026-10-02T20:00:00Z'), start, end)).toBe(true);
    // exactly the end boundary -> outside (end is exclusive)
    expect(isWithinQuietHours(new Date('2026-10-02T05:00:00Z'), start, end)).toBe(false);
  });

  it('respects the given IANA timezone rather than the host clock', () => {
    // 23:30 UTC on Oct 2 is already 01:30 CEST on Oct 3 in Europe/Berlin —
    // inside a 22:00-07:00 window only when read in that timezone.
    expect(isWithinQuietHours(new Date('2026-10-02T23:30:00Z'), '22:00', '07:00', 'Europe/Berlin')).toBe(true);
  });
});
