import { describe, expect, it } from 'vitest';
import { defaultCopyIndex, formatHistoryDate, formatLastResult, parseHistorySets, setChipLabel, type HistorySet } from './exercise-history';

const s = (over: Partial<HistorySet> = {}): HistorySet => ({ set_number: 1, weight_kg: null, reps: null, distance_km: null, duration_seconds: null, metrics: {}, ...over });

describe('"Letztes Mal" summary line', () => {
  it('strength with one weight: the weight once, repetitions per set', () => {
    expect(formatLastResult('strength', 'Bankdrücken', [s({ weight_kg: 80, reps: 10 }), s({ weight_kg: 80, reps: 9 }), s({ weight_kg: 80, reps: 8 })])).toBe('80 kg · 10 / 9 / 8 Wdh.');
  });

  it('strength with different weights never presents one weight as if it applied to every set', () => {
    expect(formatLastResult('strength', 'Bankdrücken', [s({ weight_kg: 80, reps: 10 }), s({ weight_kg: 80, reps: 9 }), s({ weight_kg: 75, reps: 8 })])).toBe('80 kg × 10 · 80 kg × 9 · 75 kg × 8');
  });

  it('strength: a gap is not filled with a zero', () => {
    expect(formatLastResult('strength', 'x', [s({ weight_kg: 60 }), s({ reps: 12 })])).toBe('60 kg · 12 Wdh.');
    expect(formatLastResult('strength', 'x', [s({ weight_kg: 60, reps: 10 }), s({ weight_kg: null, reps: 8 })])).toBe('60 kg × 10 · 8 Wdh.');
    expect(formatLastResult('strength', 'x', [s({ weight_kg: 0, reps: 5 })])).toBe('0 kg · 5 Wdh.'); // a real zero is shown
  });

  it('strength with decimals uses the German comma', () => {
    expect(formatLastResult('strength', 'x', [s({ weight_kg: 82.5, reps: 8 })])).toBe('82,5 kg · 8 Wdh.');
  });

  it('a run shows distance, time and pace', () => {
    expect(formatLastResult('cardio_distance', 'Laufen', [s({ distance_km: 5, duration_seconds: 1800 })])).toBe('5 km · 30:00 · 6:00 min/km');
  });

  it('a ride shows distance, time and speed', () => {
    expect(formatLastResult('cardio_distance', 'Radfahren', [s({ distance_km: 25, duration_seconds: 3600 })])).toBe('25 km · 1:00:00 · 25,0 km/h');
  });

  it('cardio without a distance shows only the time — no invented pace', () => {
    expect(formatLastResult('cardio_distance', 'Laufen', [s({ duration_seconds: 1800 })])).toBe('30:00');
    expect(formatLastResult('cardio_distance', 'Laufen', [s({ distance_km: 5 })])).toBe('5 km');
  });

  it('several cardio entries are summed and counted', () => {
    expect(formatLastResult('cardio_distance', 'Laufen', [s({ distance_km: 1, duration_seconds: 360 }), s({ distance_km: 5, duration_seconds: 1800 })])).toBe('6 km · 36:00 · 6:00 min/km · 2 Einträge');
  });

  it('bodyweight: repetitions, or a repeated hold', () => {
    expect(formatLastResult('bodyweight', 'Liegestütze', [s({ reps: 12 }), s({ reps: 10 }), s({ reps: 8 })])).toBe('12 / 10 / 8 Wdh.');
    expect(formatLastResult('bodyweight', 'Plank', [s({ duration_seconds: 45 }), s({ duration_seconds: 45 }), s({ duration_seconds: 45 })])).toBe('3 × 45 Sek.');
    expect(formatLastResult('bodyweight', 'Plank', [s({ duration_seconds: 45 }), s({ duration_seconds: 30 })])).toBe('45 Sek. / 30 Sek.');
    expect(formatLastResult('bodyweight', 'Dips', [s({ reps: 8, weight_kg: 10 }), s({ reps: 6, weight_kg: 10 })])).toBe('8 / 6 Wdh. · +10 kg');
    expect(formatLastResult('bodyweight', 'Dips', [s({ reps: 8, weight_kg: 10 }), s({ reps: 6, weight_kg: 5 })])).toBe('8 Wdh. +10 kg · 6 Wdh. +5 kg');
  });

  it('an interval shows rounds and the work / rest structure', () => {
    expect(formatLastResult('interval', 'HIIT', [s({ metrics: { rounds: 8, work_seconds: 40, interval_rest_seconds: 20 } })])).toBe('8 Runden · 40 Sek. Belastung / 20 Sek. Pause');
    expect(formatLastResult('interval', 'HIIT', [s({ metrics: { rounds: 8, work_seconds: 40 } })])).toBe('8 Runden · 40 Sek. Belastung');
    expect(formatLastResult('interval', 'HIIT', [s({ metrics: { rounds: 8, work_seconds: 40, interval_rest_seconds: 20 } }), s({ metrics: { rounds: 6, work_seconds: 40, interval_rest_seconds: 20 } })])).toBe('8 + 6 Runden · 40 Sek. Belastung / 20 Sek. Pause');
  });

  it('time-only types show the duration', () => {
    expect(formatLastResult('mobility', 'Dehnen', [s({ duration_seconds: 600 })])).toBe('10:00');
    expect(formatLastResult('other', 'Sauna', [s({ duration_seconds: 600 }), s({ duration_seconds: 300 })])).toBe('15:00 · 2 Einträge');
  });

  it('nothing recorded means nothing to show', () => {
    expect(formatLastResult('strength', 'x', [])).toBe('');
    expect(formatLastResult('strength', 'x', [s()])).toBe('');
    expect(formatLastResult('interval', 'x', [s()])).toBe('');
  });
});

describe('dates', () => {
  const now = new Date('2026-10-02T10:00:00Z');
  it('the calendar day in Berlin, without the year when it is this year', () => {
    expect(formatHistoryDate('2026-09-28T16:30:00Z', now)).toBe('28.09.');
  });
  it('a late-evening UTC time that is already tomorrow in Berlin', () => {
    expect(formatHistoryDate('2026-09-28T22:30:00Z', now)).toBe('29.09.');
  });
  it('shows the year for an older workout', () => {
    expect(formatHistoryDate('2025-12-31T12:00:00Z', now)).toBe('31.12.2025');
  });
  it('an unreadable date is empty, not "Invalid Date"', () => {
    expect(formatHistoryDate('nonsense', now)).toBe('');
  });
});

describe('which earlier set "Werte übernehmen" uses', () => {
  it('the set with the same number as the one about to be logged', () => {
    expect(defaultCopyIndex(3, 1)).toBe(0);
    expect(defaultCopyIndex(3, 2)).toBe(1);
    expect(defaultCopyIndex(3, 3)).toBe(2);
  });
  it('the last earlier set once this session has more sets than the earlier one', () => {
    expect(defaultCopyIndex(3, 4)).toBe(2);
    expect(defaultCopyIndex(3, 10)).toBe(2);
  });
  it('stays valid for degenerate input', () => {
    expect(defaultCopyIndex(0, 1)).toBe(0);
    expect(defaultCopyIndex(2, 0)).toBe(0);
  });
});

describe('parsing the history payload', () => {
  it('keeps numbers, nulls and metrics; drops junk', () => {
    const sets = parseHistorySets([
      { set_number: 1, weight_kg: 80, reps: 10, distance_km: null, duration_seconds: null, metrics: { rpe: 8 } },
      'junk',
      null,
      { set_number: '2', weight_kg: '77.5', reps: null, metrics: 'not an object' },
    ]);
    expect(sets).toEqual([
      { set_number: 1, weight_kg: 80, reps: 10, distance_km: null, duration_seconds: null, metrics: { rpe: 8 } },
      { set_number: 2, weight_kg: 77.5, reps: null, distance_km: null, duration_seconds: null, metrics: {} },
    ]);
  });
  it('anything that is not a list is no sets', () => {
    expect(parseHistorySets(null)).toEqual([]);
    expect(parseHistorySets({})).toEqual([]);
  });
});

describe('set chips', () => {
  it('describe one earlier set briefly', () => {
    expect(setChipLabel('strength', s({ weight_kg: 80, reps: 9 }))).toBe('80 kg × 9');
    expect(setChipLabel('cardio_distance', s({ distance_km: 5, duration_seconds: 1800 }))).toBe('5 km · 30:00');
    expect(setChipLabel('bodyweight', s({ reps: 12 }))).toBe('12 Wdh.');
    expect(setChipLabel('interval', s({ metrics: { rounds: 8, work_seconds: 40, interval_rest_seconds: 20 } }))).toBe('8 Runden · 40/20 Sek.');
  });
});
