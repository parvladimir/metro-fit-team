import { describe, expect, it } from 'vitest';
import { buildSetEdit, localDateString, setFieldsFor, shiftByDays } from './set-input';

const get = (o: Record<string, string>) => (f: string) => o[f] ?? '';

describe('editable fields per type (no irrelevant inputs)', () => {
  it('strength / running / interval / bodyweight / others', () => {
    expect(setFieldsFor('strength')).toEqual(['weight', 'reps']);
    expect(setFieldsFor('cardio_distance')).toEqual(['duration', 'distance']);
    expect(setFieldsFor('cardio')).toEqual(['duration', 'distance']);
    expect(setFieldsFor('interval')).toEqual(['rounds', 'work', 'rest']);
    expect(setFieldsFor('bodyweight')).toEqual(['reps', 'duration', 'weight']);
    expect(setFieldsFor('mobility')).toEqual(['duration']);
  });
});

describe('F. strength 80 kg → 70 kg', () => {
  it('produces corrected values and keeps other metrics', () => {
    const r = buildSetEdit('strength', get({ weight: '70', reps: '10' }), { rpe: 8 });
    expect(r).toMatchObject({ ok: true, values: { weight_kg: 70, reps: 10 }, metrics: { rpe: 8 } });
  });
  it('requires weight and reps like logging does', () => {
    expect(buildSetEdit('strength', get({ reps: '10' }), {}).ok).toBe(false);
  });
});

describe('G. cardio 8.2 km / 42:30 → 5 km / 30:00', () => {
  it('accepts comma decimals and mm:ss', () => {
    const r = buildSetEdit('cardio_distance', get({ duration: '30:00', distance: '5,0' }), { calories: 400 });
    expect(r).toMatchObject({ ok: true, values: { duration_seconds: 1800, distance_km: 5 }, metrics: { calories: 400 } });
  });
  it('rejects a malformed time', () => {
    expect(buildSetEdit('cardio_distance', get({ duration: '30:99' }), {}).ok).toBe(false);
  });
});

describe('interval / others', () => {
  it('interval stores rounds/work/rest in metrics', () => {
    const r = buildSetEdit('interval', get({ rounds: '8', work: '40', rest: '20' }), {});
    expect(r).toMatchObject({ ok: true, metrics: { rounds: 8, work_seconds: 40, interval_rest_seconds: 20 } });
  });
  it('duration-only types need a duration', () => {
    expect(buildSetEdit('mobility', get({}), {}).ok).toBe(false);
    expect(buildSetEdit('mobility', get({ duration: '10' }), {})).toMatchObject({ ok: true, values: { duration_seconds: 600 } });
  });
});

describe('date shifting', () => {
  it('moves by whole days and keeps the time of day', () => {
    const d = shiftByDays(new Date('2026-09-17T10:30:00Z'), '2026-09-17', '2026-09-15');
    expect(d.toISOString()).toBe('2026-09-15T10:30:00.000Z');
  });
  it('invalid input leaves the timestamp unchanged', () => {
    const d = new Date('2026-09-17T10:30:00Z');
    expect(shiftByDays(d, 'x', 'y')).toBe(d);
  });
  it('shows the Berlin calendar date', () => {
    expect(localDateString(new Date('2026-09-17T22:30:00Z'))).toBe('2026-09-18');
  });
});
