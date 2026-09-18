import { describe, expect, it } from 'vitest';
import { formatDuration, formatPace, formatSpeed, paceSecondsPerKm, parseDuration, speedKmh, summarizeSet } from './workout-metrics';
import { prefersPace, usesSetTargets } from './exercise-types';

describe('parseDuration', () => {
  it('parses mm:ss, h:mm:ss and bare minutes', () => {
    expect(parseDuration('42:30')).toBe(2550);
    expect(parseDuration('01:15:00')).toBe(4500);
    expect(parseDuration('45')).toBe(2700);
  });
  it('rejects garbage and out-of-range seconds', () => {
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('10:75')).toBeNull();
    expect(parseDuration('')).toBeNull();
  });
});

describe('cardio maths', () => {
  it('computes running pace 42:30 over 8.2 km as 5:11 min/km', () => {
    const pace = paceSecondsPerKm(2550, 8.2)!;
    expect(formatPace(pace)).toBe('5:11 min/km');
  });
  it('computes cycling speed 1:15:00 over 32.5 km as 26 km/h', () => {
    expect(speedKmh(4500, 32.5)).toBeCloseTo(26, 5);
    expect(formatSpeed(26)).toBe('26,0 km/h');
  });
  it('returns null without usable input', () => {
    expect(paceSecondsPerKm(0, 5)).toBeNull();
    expect(speedKmh(600, null)).toBeNull();
  });
  it('formats durations', () => {
    expect(formatDuration(2550)).toBe('42:30');
    expect(formatDuration(4500)).toBe('1:15:00');
  });
});

describe('summarizeSet', () => {
  const base = { weight_kg: null, reps: null, distance_km: null, duration_seconds: null, metrics: {} };
  it('strength: weight, reps, RPE', () => {
    expect(summarizeSet('strength', { ...base, weight_kg: 80, reps: 10, metrics: { rpe: 8 } })).toBe('80 kg · 10 Wdh. · RPE 8');
  });
  it('bodyweight does not require weight and shows extra weight', () => {
    expect(summarizeSet('bodyweight', { ...base, reps: 10, weight_kg: 10 })).toBe('10 Wdh. · +10 kg');
    expect(summarizeSet('bodyweight', { ...base, reps: 20 })).toBe('20 Wdh.');
  });
  it('interval', () => {
    expect(summarizeSet('interval', { ...base, metrics: { rounds: 8, work_seconds: 40, interval_rest_seconds: 20 } })).toBe(
      '8 Runden · 40 Sek. Belastung · 20 Sek. Pause'
    );
  });
  it('legacy cardio type is treated as distance cardio', () => {
    expect(summarizeSet('cardio', { ...base, duration_seconds: 600, distance_km: 2 })).toContain('Pace 5:00 min/km');
  });
});

describe('exercise type helpers', () => {
  it('only strength/bodyweight use set targets', () => {
    expect(usesSetTargets('strength')).toBe(true);
    expect(usesSetTargets('cardio_distance')).toBe(false);
  });
  it('picks pace for runs, speed for rides', () => {
    expect(prefersPace('Laufband')).toBe(true);
    expect(prefersPace('Radfahren (Ergometer)')).toBe(false);
  });
});
