import { describe, expect, it } from 'vitest';
import {
  formatAchieved,
  formatTargets,
  hasTargets,
  parseTargets,
  targetFieldsFor,
  targetsFromRow,
  targetsToColumns,
  trackingDescription,
} from './plan-targets';

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const set = (o: Partial<{ weight_kg: number; reps: number; distance_km: number; duration_seconds: number; metrics: object }>) =>
  ({ weight_kg: null, reps: null, distance_km: null, duration_seconds: null, metrics: {}, ...o }) as never;

describe('tracking description', () => {
  it('explains what is recorded per type', () => {
    expect(trackingDescription('strength')).toBe('Sätze · Wiederholungen · Gewicht');
    expect(trackingDescription('cardio_distance')).toContain('Pace');
    expect(trackingDescription('interval')).toBe('Runden · Belastungszeit · Pause');
    expect(trackingDescription('cardio')).toContain('Zeit'); // legacy → cardio_distance
    expect(trackingDescription('mobility')).toBe('Dauer');
  });
});

describe('target fields per type (no irrelevant inputs)', () => {
  it('strength: sets/reps/weight', () => expect(targetFieldsFor('strength')).toEqual(['sets', 'reps', 'weight']));
  it('bodyweight: reps OR duration', () => {
    expect(targetFieldsFor('bodyweight', 'reps')).toEqual(['sets', 'reps', 'weight']);
    expect(targetFieldsFor('bodyweight', 'duration')).toEqual(['sets', 'duration', 'weight']);
  });
  it('cardio_distance: duration + distance', () => expect(targetFieldsFor('cardio_distance')).toEqual(['duration', 'distance']));
  it('interval: rounds/work/rest', () => expect(targetFieldsFor('interval')).toEqual(['rounds', 'work', 'rest']));
  it('sport/mobility/cardio_time: duration only', () => {
    for (const t of ['sport', 'mobility', 'cardio_time', 'other'] as const) expect(targetFieldsFor(t)).toEqual(['duration']);
  });
});

describe('A. Bankdrücken 3×10 / 80 kg', () => {
  it('parses and summarises', () => {
    const t = parseTargets('strength', form({ targetSets: '3', targetReps: '10', targetWeight: '80' }));
    expect(t).toEqual({ sets: 3, reps: 10, weightKg: 80 });
    expect(formatTargets('strength', t)).toBe('3 × 10 · 80 kg');
  });
});

describe('B. Laufen 5 km / 30 Min.', () => {
  it('parses distance with comma and mm:ss', () => {
    const t = parseTargets('cardio_distance', form({ targetDistance: '5,0', targetDuration: '30:00' }));
    expect(t).toEqual({ distanceKm: 5, durationSeconds: 1800 });
    expect(formatTargets('cardio_distance', t)).toBe('5 km · 30 Min.');
  });
  it('ignores irrelevant strength fields', () => {
    expect(parseTargets('cardio_distance', form({ targetSets: '3', targetReps: '10' }))).toEqual({});
  });
});

describe('C. Radfahren 25 km / 60 Min.', () => {
  it('bare number means minutes', () => {
    const t = parseTargets('cardio_distance', form({ targetDistance: '25', targetDuration: '60' }));
    expect(formatTargets('cardio_distance', t)).toBe('25 km · 60 Min.');
  });
});

describe('D. Plank (bodyweight duration)', () => {
  it('needs no weight', () => {
    const t = parseTargets('bodyweight', form({ targetMode: 'duration', targetSets: '3', targetDuration: '1:00' }));
    expect(t).toEqual({ sets: 3, durationSeconds: 60 });
    expect(formatTargets('bodyweight', t)).toBe('3 × 1 Min.');
  });
  it('reps mode with added weight', () => {
    const t = parseTargets('bodyweight', form({ targetSets: '3', targetReps: '12', targetWeight: '10' }));
    expect(formatTargets('bodyweight', t)).toBe('3 × 12 · +10 kg');
  });
});

describe('E. HIIT', () => {
  it('rounds / work / rest', () => {
    const t = parseTargets('interval', form({ targetRounds: '8', targetWork: '40', targetRest: '20' }));
    expect(formatTargets('interval', t)).toBe('8 Runden · 40/20 Sek.');
  });
});

describe('F. custom exercise types use the same rules', () => {
  it('interval custom exercise (Sandsack)', () => {
    expect(trackingDescription('interval')).toBe('Runden · Belastungszeit · Pause');
    expect(targetFieldsFor('interval')).toContain('rounds');
  });
});

describe('G. no targets', () => {
  it('empty and invalid input yields nothing', () => {
    const t = parseTargets('strength', form({ targetSets: '', targetReps: 'abc', targetWeight: '-4' }));
    expect(t).toEqual({});
    expect(hasTargets(t)).toBe(false);
    expect(formatTargets('strength', t)).toBe('');
  });
});

describe('storage round-trip & legacy rows', () => {
  it('columns → row → targets', () => {
    const t = parseTargets('interval', form({ targetRounds: '8', targetWork: '40', targetRest: '20' }));
    expect(targetsFromRow('interval', targetsToColumns(t))).toEqual(t);
  });
  it('legacy row with only sets/reps still renders', () => {
    const t = targetsFromRow('strength', { target_sets: 3, target_reps: 10 });
    expect(formatTargets('strength', t)).toBe('3 × 10');
  });
  it('legacy sets/reps on a cardio exercise are not shown', () => {
    expect(formatTargets('cardio_distance', targetsFromRow('cardio_distance', { target_sets: 3, target_reps: 10 }))).toBe('');
  });
  it('numeric strings from postgres are handled', () => {
    const t = targetsFromRow('strength', { target_sets: 3, target_reps: 10, target_weight_kg: '80.00' });
    expect(t.weightKg).toBe(80);
  });
});

describe('planned vs achieved', () => {
  it('strength', () => {
    expect(formatAchieved('strength', [set({ reps: 10, weight_kg: 80 }), set({ reps: 9, weight_kg: 80 }), set({ reps: 8, weight_kg: 80 })])).toBe(
      '3 Sätze · 10 / 9 / 8 Wdh. · 80 kg',
    );
  });
  it('running', () => {
    expect(formatAchieved('cardio_distance', [set({ distance_km: 5.2, duration_seconds: 1725 })])).toBe('5,2 km · 28:45');
  });
  it('no sets → empty', () => expect(formatAchieved('strength', [])).toBe(''));
});
