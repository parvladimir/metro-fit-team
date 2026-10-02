import { normalizeExerciseType } from '@/lib/exercise-types';
import { formatDuration } from '@/lib/workout-metrics';
import type { ExerciseType, SetMetrics } from '@/types/database';

/** Every editable input of the set logger. Values are the raw text in the input
 * (German decimal comma allowed) — the server parses and validates them. */
export type FieldName =
  | 'weight'
  | 'reps'
  | 'duration'
  | 'distanceKm'
  | 'rounds'
  | 'workSeconds'
  | 'intervalRestSeconds'
  | 'rpe'
  | 'restSeconds'
  | 'calories'
  | 'avgHeartRate'
  | 'maxHeartRate'
  | 'elevationGainM'
  | 'inclinePct'
  | 'notes';

export type FormValues = Partial<Record<FieldName, string>>;
export type BodyweightMode = 'reps' | 'duration';

/** The part of a logged set that can seed a form. */
export interface SetSnapshot {
  weight_kg: number | null;
  reps: number | null;
  distance_km: number | null;
  duration_seconds: number | null;
  metrics: SetMetrics;
}

/** Strength, bodyweight and interval entries are "sets" of one movement that are
 * repeated back to back; everything else (a run, a ride, a stretch) is a single
 * measured entry that must never be silently repeated. */
export function isSetBased(type: ExerciseType): boolean {
  const t = normalizeExerciseType(type);
  return t === 'strength' || t === 'bodyweight' || t === 'interval';
}

/** Number → input text with a German decimal comma ("82,5"). */
export function toInputNumber(n: number): string {
  return String(n).replace('.', ',');
}

/** Everything an earlier set can put into the inputs, for the field kinds that
 * exist for this exercise type. Per-set measurements (RPE, rest, heart rate,
 * calories, elevation, incline) and notes are never copied. A missing value stays
 * missing — it is never turned into a zero. */
export function valuesFromSet(type: ExerciseType, set: SetSnapshot): { values: FormValues; bwMode?: BodyweightMode } {
  const t = normalizeExerciseType(type);
  const values: FormValues = {};
  let bwMode: BodyweightMode | undefined;
  const m = set.metrics ?? {};

  if (t === 'strength') {
    if (set.weight_kg != null) values.weight = toInputNumber(set.weight_kg);
    if (set.reps != null) values.reps = String(set.reps);
  } else if (t === 'bodyweight') {
    if (set.reps != null) {
      bwMode = 'reps';
      values.reps = String(set.reps);
    } else if (set.duration_seconds != null) {
      bwMode = 'duration';
      values.duration = formatDuration(set.duration_seconds);
    }
    if (set.weight_kg != null && set.weight_kg > 0) values.weight = toInputNumber(set.weight_kg);
  } else if (t === 'cardio_distance') {
    if (set.duration_seconds != null) values.duration = formatDuration(set.duration_seconds);
    if (set.distance_km != null) values.distanceKm = toInputNumber(set.distance_km);
  } else if (t === 'interval') {
    if (m.rounds != null) values.rounds = String(m.rounds);
    if (m.work_seconds != null) values.workSeconds = String(m.work_seconds);
    if (m.interval_rest_seconds != null) values.intervalRestSeconds = String(m.interval_rest_seconds);
  } else if (set.duration_seconds != null) {
    values.duration = formatDuration(set.duration_seconds);
  }
  return { values, bwMode };
}

/** What stays in the form after a set was saved, as a suggestion for the NEXT one.
 * Strength keeps weight + repetitions, bodyweight keeps the chosen mode's value and
 * the extra weight, an interval keeps its structure. Single measured entries and
 * every per-set measurement or note are dropped. */
export function retainedAfterSave(type: ExerciseType, bwMode: BodyweightMode, submitted: FormValues): FormValues {
  const t = normalizeExerciseType(type);
  const keep: FieldName[] =
    t === 'strength'
      ? ['weight', 'reps']
      : t === 'bodyweight'
        ? [bwMode === 'reps' ? 'reps' : 'duration', 'weight']
        : t === 'interval'
          ? ['rounds', 'workSeconds', 'intervalRestSeconds']
          : [];
  const out: FormValues = {};
  for (const field of keep) {
    const v = submitted[field]?.trim();
    if (v) out[field] = v;
  }
  return out;
}

/** The suggestion that a reloaded page derives from the last SAVED set of this
 * exercise (nothing is remembered about unsaved input here). */
export function suggestionFromSavedSet(type: ExerciseType, set: SetSnapshot | undefined): { values: FormValues; bwMode?: BodyweightMode } {
  if (!set || !isSetBased(type)) return { values: {} };
  return valuesFromSet(type, set);
}

function normalized(v: FormValues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(v)) {
    const s = (raw ?? '').trim();
    if (s) out[k] = s;
  }
  return out;
}

export function hasAnyValue(v: FormValues): boolean {
  return Object.keys(normalized(v)).length > 0;
}

/** Equal when every field has the same trimmed text; empty and missing are the same. */
export function sameValues(a: FormValues, b: FormValues): boolean {
  const x = normalized(a);
  const y = normalized(b);
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) if (x[k] !== y[k]) return false;
  return true;
}

/** Keeps only the fields that belong in the form for this type — a draft or a copy
 * from a different shape can never put a stranger field into the inputs. */
export function fieldsAllowedFor(type: ExerciseType, bwMode: BodyweightMode): ReadonlySet<FieldName> {
  const t = normalizeExerciseType(type);
  const more: FieldName[] = ['notes', 'calories', 'avgHeartRate', 'maxHeartRate'];
  switch (t) {
    case 'strength':
      return new Set<FieldName>(['weight', 'reps', 'rpe', 'restSeconds', 'notes']);
    case 'bodyweight':
      return new Set<FieldName>([bwMode === 'reps' ? 'reps' : 'duration', 'weight', 'rpe', 'notes', 'calories', 'avgHeartRate', 'maxHeartRate']);
    case 'cardio_distance':
      return new Set<FieldName>(['duration', 'distanceKm', 'elevationGainM', 'inclinePct', ...more]);
    case 'interval':
      return new Set<FieldName>(['rounds', 'workSeconds', 'intervalRestSeconds', ...more]);
    default:
      return new Set<FieldName>(['duration', ...more]);
  }
}

export function pickAllowed(values: FormValues, allowed: ReadonlySet<FieldName>): FormValues {
  const out: FormValues = {};
  for (const [k, v] of Object.entries(values)) if (allowed.has(k as FieldName) && v != null && v !== '') out[k as FieldName] = v;
  return out;
}
