import { describe, expect, it } from 'vitest';
import {
  ALL_NOTIFICATION_CATEGORIES,
  DEFAULT_ON_CATEGORIES,
  MOTIVATION_CATEGORIES,
  OPT_IN_CATEGORIES,
  isMotivationPaused,
  isOptInCategory,
  isWithinQuietHours,
  passesPushGate,
  type GatePreferences,
  type PushCategory,
} from './notification-gating';

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

describe('notification categories', () => {
  it('lists every category exactly once, default-on first', () => {
    expect(new Set(ALL_NOTIFICATION_CATEGORIES).size).toBe(ALL_NOTIFICATION_CATEGORIES.length);
    expect(ALL_NOTIFICATION_CATEGORIES).toEqual([...DEFAULT_ON_CATEGORIES, ...OPT_IN_CATEGORIES]);
    expect(DEFAULT_ON_CATEGORIES).toHaveLength(9);
  });

  it('the opt-in categories are exactly the duel and joint-training ones', () => {
    expect([...OPT_IN_CATEGORIES]).toEqual(['duelle', 'gemeinsame_trainings']);
    for (const c of DEFAULT_ON_CATEGORIES) expect(isOptInCategory(c)).toBe(false);
    for (const c of OPT_IN_CATEGORIES) expect(isOptInCategory(c)).toBe(true);
  });

  it('the motivation pause covers the six reminder/digest categories — never direct interaction or the opt-ins', () => {
    expect([...MOTIVATION_CATEGORIES].sort()).toEqual(
      ['herausforderung', 'messungserinnerung', 'team_aktivitaet', 'trainingserinnerung', 'wochenziel', 'wochenzusammenfassung'],
    );
    for (const c of ['chat_nachrichten', 'reaktionen_antworten', 'erwaehnungen', ...OPT_IN_CATEGORIES] as PushCategory[]) {
      expect(MOTIVATION_CATEGORIES.has(c)).toBe(false);
    }
  });
});

describe('passesPushGate', () => {
  const NOON = new Date('2026-10-02T10:00:00Z'); // 12:00 Berlin
  const LATE = new Date('2026-10-02T21:00:00Z'); // 23:00 Berlin
  const pref = (overrides: Record<string, unknown> = {}): GatePreferences => ({
    quiet_hours_start: null,
    quiet_hours_end: null,
    motivation_paused_until: null,
    ...overrides,
  });
  const QUIET = { quiet_hours_start: '22:00:00', quiet_hours_end: '07:00:00' };
  const PAUSED = { motivation_paused_until: '2026-10-20T00:00:00Z' };

  describe('default-on categories (behaviour unchanged)', () => {
    it.each(DEFAULT_ON_CATEGORIES)('%s: no preference row fails open', (c) => {
      expect(passesPushGate(undefined, c, NOON)).toBe(true);
      expect(passesPushGate(null, c, NOON)).toBe(true);
    });

    it.each(DEFAULT_ON_CATEGORIES)('%s: delivered when true or when the column is absent, blocked only on an explicit false', (c) => {
      expect(passesPushGate(pref({ [c]: true }), c, NOON)).toBe(true);
      expect(passesPushGate(pref(), c, NOON)).toBe(true);
      expect(passesPushGate(pref({ [c]: false }), c, NOON)).toBe(false);
    });

    it.each(DEFAULT_ON_CATEGORIES)('%s: quiet hours block it', (c) => {
      expect(passesPushGate(pref({ [c]: true, ...QUIET }), c, LATE)).toBe(false);
      expect(passesPushGate(pref({ [c]: true, ...QUIET }), c, NOON)).toBe(true);
    });

    it.each(DEFAULT_ON_CATEGORIES)('%s: a motivation pause blocks it only for reminder/digest categories', (c) => {
      expect(passesPushGate(pref({ [c]: true, ...PAUSED }), c, NOON)).toBe(!MOTIVATION_CATEGORIES.has(c));
    });

    it('a pause that has already ended no longer blocks anything', () => {
      expect(passesPushGate(pref({ wochenzusammenfassung: true, motivation_paused_until: '2026-09-01T00:00:00Z' }), 'wochenzusammenfassung', NOON)).toBe(true);
    });
  });

  describe('opt-in categories (duelle, gemeinsame_trainings)', () => {
    it.each(OPT_IN_CATEGORIES)('%s: no preference row fails CLOSED', (c) => {
      expect(passesPushGate(undefined, c, NOON)).toBe(false);
      expect(passesPushGate(null, c, NOON)).toBe(false);
    });

    it.each(OPT_IN_CATEGORIES)('%s: false, null or an absent column (code ahead of its migration) never delivers', (c) => {
      expect(passesPushGate(pref({ [c]: false }), c, NOON)).toBe(false);
      expect(passesPushGate(pref({ [c]: null }), c, NOON)).toBe(false);
      expect(passesPushGate(pref(), c, NOON)).toBe(false);
    });

    it.each(OPT_IN_CATEGORIES)('%s: only an explicit boolean true delivers — not a truthy stand-in', (c) => {
      expect(passesPushGate(pref({ [c]: true }), c, NOON)).toBe(true);
      expect(passesPushGate(pref({ [c]: 'on' }), c, NOON)).toBe(false);
      expect(passesPushGate(pref({ [c]: 1 }), c, NOON)).toBe(false);
    });

    it.each(OPT_IN_CATEGORIES)('%s: opted in but inside quiet hours — still blocked', (c) => {
      expect(passesPushGate(pref({ [c]: true, ...QUIET }), c, LATE)).toBe(false);
    });

    it.each(OPT_IN_CATEGORIES)('%s: opted in while motivation is paused — still delivered (an invitation is not a nudge)', (c) => {
      const p = pref({ [c]: true, wochenzusammenfassung: true, ...PAUSED });
      expect(passesPushGate(p, c, NOON)).toBe(true);
      // ...while a reminder/digest category under the very same preferences is paused.
      expect(passesPushGate(p, 'wochenzusammenfassung', NOON)).toBe(false);
    });

    it('one opt-in does not enable the other', () => {
      const p = pref({ duelle: true });
      expect(passesPushGate(p, 'duelle', NOON)).toBe(true);
      expect(passesPushGate(p, 'gemeinsame_trainings', NOON)).toBe(false);
    });
  });
});
