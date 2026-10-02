import { describe, expect, it } from 'vitest';
import { fieldsAllowedFor, hasAnyValue, isSetBased, pickAllowed, retainedAfterSave, sameValues, suggestionFromSavedSet, toInputNumber, valuesFromSet, type SetSnapshot } from './set-form';

const set = (over: Partial<SetSnapshot> = {}): SetSnapshot => ({ weight_kg: null, reps: null, distance_km: null, duration_seconds: null, metrics: {}, ...over });

describe('which exercise types repeat as sets', () => {
  it('strength, bodyweight and interval are set based; single measured entries are not', () => {
    expect(isSetBased('strength')).toBe(true);
    expect(isSetBased('bodyweight')).toBe(true);
    expect(isSetBased('interval')).toBe(true);
    for (const t of ['cardio_distance', 'cardio', 'cardio_time', 'mobility', 'sport', 'other'] as const) expect(isSetBased(t)).toBe(false);
  });
});

describe('copying an earlier set into the inputs', () => {
  it('strength: weight with a German decimal comma and the repetitions', () => {
    expect(valuesFromSet('strength', set({ weight_kg: 82.5, reps: 8 })).values).toEqual({ weight: '82,5', reps: '8' });
  });

  it('keeps a missing value missing — never a zero', () => {
    expect(valuesFromSet('strength', set({ weight_kg: 60 })).values).toEqual({ weight: '60' });
    expect(valuesFromSet('strength', set({ reps: 12 })).values).toEqual({ reps: '12' });
    expect(valuesFromSet('strength', set({ weight_kg: 0, reps: 5 })).values).toEqual({ weight: '0', reps: '5' }); // a real zero stays
  });

  it('never copies per-set measurements or notes', () => {
    const copied = valuesFromSet('strength', set({ weight_kg: 80, reps: 10, metrics: { rpe: 9, rest_seconds: 90, calories: 30, avg_heart_rate: 150 } })).values;
    expect(Object.keys(copied).sort()).toEqual(['reps', 'weight']);
  });

  it('bodyweight: adopts the mode of the set it copies', () => {
    expect(valuesFromSet('bodyweight', set({ reps: 12, weight_kg: 10 }))).toEqual({ values: { reps: '12', weight: '10' }, bwMode: 'reps' });
    expect(valuesFromSet('bodyweight', set({ duration_seconds: 45 }))).toEqual({ values: { duration: '0:45' }, bwMode: 'duration' });
    expect(valuesFromSet('bodyweight', set({ reps: 8, weight_kg: 0 })).values).toEqual({ reps: '8' }); // no "extra weight 0"
  });

  it('distance cardio: time and distance only, no heart rate or calories', () => {
    const r = valuesFromSet('cardio_distance', set({ duration_seconds: 1800, distance_km: 5.25, metrics: { avg_heart_rate: 150, calories: 400, elevation_gain_m: 30 } }));
    expect(r.values).toEqual({ duration: '30:00', distanceKm: '5,25' });
  });

  it('interval: the structure from metrics', () => {
    expect(valuesFromSet('interval', set({ duration_seconds: 480, metrics: { rounds: 8, work_seconds: 40, interval_rest_seconds: 20 } })).values).toEqual({ rounds: '8', workSeconds: '40', intervalRestSeconds: '20' });
  });

  it('duration-only types copy the duration', () => {
    expect(valuesFromSet('mobility', set({ duration_seconds: 600 })).values).toEqual({ duration: '10:00' });
  });
});

describe('what stays in the form after a set is saved', () => {
  it('strength keeps weight and repetitions, and drops RPE, rest and the note', () => {
    expect(retainedAfterSave('strength', 'reps', { weight: '80', reps: '10', rpe: '8', restSeconds: '90', notes: 'schwer' })).toEqual({ weight: '80', reps: '10' });
  });

  it('keeps exactly what the user typed (decimal comma included)', () => {
    expect(retainedAfterSave('strength', 'reps', { weight: '82,5', reps: ' 8 ' })).toEqual({ weight: '82,5', reps: '8' });
  });

  it('bodyweight keeps the active mode\'s value and the extra weight, not the other mode', () => {
    expect(retainedAfterSave('bodyweight', 'reps', { reps: '12', duration: '00:30', weight: '5', rpe: '7' })).toEqual({ reps: '12', weight: '5' });
    expect(retainedAfterSave('bodyweight', 'duration', { reps: '12', duration: '00:45' })).toEqual({ duration: '00:45' });
  });

  it('an interval keeps its structure and no physiological values', () => {
    expect(retainedAfterSave('interval', 'reps', { rounds: '8', workSeconds: '40', intervalRestSeconds: '20', avgHeartRate: '160', calories: '90' })).toEqual({ rounds: '8', workSeconds: '40', intervalRestSeconds: '20' });
  });

  it('a run, a ride or a stretch is never carried over as a new entry', () => {
    for (const t of ['cardio_distance', 'cardio_time', 'mobility', 'sport', 'other'] as const) {
      expect(retainedAfterSave(t, 'reps', { duration: '42:30', distanceKm: '8,2', avgHeartRate: '150', calories: '500' })).toEqual({});
    }
  });
});

describe('suggestions after a reload', () => {
  it('derive from the last SAVED set of a set-based exercise', () => {
    expect(suggestionFromSavedSet('strength', set({ weight_kg: 80, reps: 9 })).values).toEqual({ weight: '80', reps: '9' });
  });

  it('nothing for a single measured entry, or when nothing was saved', () => {
    expect(suggestionFromSavedSet('cardio_distance', set({ duration_seconds: 1800, distance_km: 5 })).values).toEqual({});
    expect(suggestionFromSavedSet('strength', undefined).values).toEqual({});
  });
});

describe('comparing and filtering input values', () => {
  it('empty and missing are the same, whitespace does not count', () => {
    expect(sameValues({ weight: '80', reps: '' }, { weight: ' 80 ' })).toBe(true);
    expect(sameValues({ weight: '80' }, { weight: '82,5' })).toBe(false);
    expect(sameValues({}, { notes: ' ' })).toBe(true);
    expect(hasAnyValue({ notes: ' ' })).toBe(false);
    expect(hasAnyValue({ reps: '0' })).toBe(true); // "0" is a real value
  });

  it('only fields that exist for the type survive', () => {
    const allowed = fieldsAllowedFor('strength', 'reps');
    expect(pickAllowed({ weight: '80', reps: '10', distanceKm: '5', duration: '10:00' }, allowed)).toEqual({ weight: '80', reps: '10' });
    expect(fieldsAllowedFor('bodyweight', 'duration').has('reps')).toBe(false);
    expect(fieldsAllowedFor('bodyweight', 'duration').has('duration')).toBe(true);
  });

  it('numbers render with a decimal comma', () => {
    expect(toInputNumber(12.5)).toBe('12,5');
    expect(toInputNumber(80)).toBe('80');
  });
});
