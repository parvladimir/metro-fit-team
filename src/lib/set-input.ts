import { normalizeExerciseType } from '@/lib/exercise-types';
import { parseDuration } from '@/lib/workout-metrics';
import type { ExerciseType, SetMetrics } from '@/types/database';

/** Which editable inputs a logged set has, per exercise type (no irrelevant fields). */
export type SetField = 'weight' | 'reps' | 'duration' | 'distance' | 'rounds' | 'work' | 'rest';

export function setFieldsFor(type: ExerciseType): SetField[] {
  switch (normalizeExerciseType(type)) {
    case 'strength':
      return ['weight', 'reps'];
    case 'bodyweight':
      return ['reps', 'duration', 'weight'];
    case 'cardio_distance':
      return ['duration', 'distance'];
    case 'interval':
      return ['rounds', 'work', 'rest'];
    default:
      return ['duration'];
  }
}

export interface SetValues {
  weight_kg: number | null;
  reps: number | null;
  distance_km: number | null;
  duration_seconds: number | null;
}

export type SetEditResult = { ok: true; values: SetValues; metrics: SetMetrics } | { ok: false; error: string };

function num(raw: string, min: number, max: number): number | null | 'invalid' {
  const s = raw.trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= min && n <= max ? n : 'invalid';
}

/** Validates an edited set exactly like logging one (same ranges, same required
 * fields per type) and merges the type's metrics into the existing metrics so
 * untouched data (RPE, heart rate, …) survives. */
export function buildSetEdit(type: ExerciseType, get: (field: SetField) => string, existing: SetMetrics): SetEditResult {
  const kind = normalizeExerciseType(type);
  const weight = num(get('weight'), 0, 9999);
  const reps = num(get('reps'), 0, 10000);
  const distance = num(get('distance'), 0, 9999);
  const rounds = num(get('rounds'), 1, 500);
  const work = num(get('work'), 1, 3600);
  const rest = num(get('rest'), 0, 3600);
  if ([weight, reps, distance, rounds, work, rest].includes('invalid')) return { ok: false, error: 'Bitte prüfe deine Eingaben.' };

  const durRaw = get('duration').trim();
  let duration: number | null = null;
  if (durRaw) {
    duration = parseDuration(durRaw);
    if (duration === null || duration > 24 * 3600) return { ok: false, error: 'Zeit bitte als mm:ss oder h:mm:ss eingeben.' };
  }

  const values: SetValues = { weight_kg: null, reps: null, distance_km: null, duration_seconds: null };
  const metrics: SetMetrics = { ...existing };
  const n = (v: number | null | 'invalid') => v as number | null;

  if (kind === 'strength') {
    if (n(reps) === null || n(weight) === null) return { ok: false, error: 'Gewicht und Wiederholungen sind nötig.' };
    values.weight_kg = n(weight);
    values.reps = n(reps);
  } else if (kind === 'bodyweight') {
    if (n(reps) === null && duration === null) return { ok: false, error: 'Wiederholungen oder Dauer angeben.' };
    values.reps = n(reps);
    values.duration_seconds = duration;
    values.weight_kg = n(weight);
  } else if (kind === 'cardio_distance') {
    if (duration === null && n(distance) === null) return { ok: false, error: 'Zeit oder Distanz angeben.' };
    values.duration_seconds = duration;
    values.distance_km = n(distance);
  } else if (kind === 'interval') {
    if (n(rounds) === null || n(work) === null) return { ok: false, error: 'Runden und Belastungszeit angeben.' };
    metrics.rounds = n(rounds)!;
    metrics.work_seconds = n(work)!;
    if (n(rest) !== null) metrics.interval_rest_seconds = n(rest)!;
    else delete metrics.interval_rest_seconds;
    values.duration_seconds = duration ?? n(rounds)! * (n(work)! + (n(rest) ?? 0));
  } else {
    if (duration === null) return { ok: false, error: 'Bitte eine Dauer angeben.' };
    values.duration_seconds = duration;
  }
  return { ok: true, values, metrics };
}

/** Shift a timestamp by the whole-day difference between two YYYY-MM-DD dates. */
export function shiftByDays(original: Date, fromDate: string, toDate: string): Date {
  const a = Date.parse(`${fromDate}T00:00:00Z`);
  const b = Date.parse(`${toDate}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return original;
  return new Date(original.getTime() + (b - a));
}

/** Calendar date (YYYY-MM-DD) of a timestamp as the user sees it (Europe/Berlin). */
export function localDateString(d: Date): string {
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
}
