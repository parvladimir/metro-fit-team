import type { ExerciseType, MuscleGroup } from '@/types/database';

export const EXERCISE_TYPE_OPTIONS: { value: Exclude<ExerciseType, 'cardio'>; label: string; hint: string }[] = [
  { value: 'strength', label: 'Kraft', hint: 'Sätze, Wiederholungen, Gewicht' },
  { value: 'bodyweight', label: 'Körpergewicht', hint: 'Wiederholungen oder Dauer' },
  { value: 'cardio_distance', label: 'Ausdauer (Distanz)', hint: 'Zeit und Strecke' },
  { value: 'cardio_time', label: 'Ausdauer (Zeit)', hint: 'Nur Dauer' },
  { value: 'interval', label: 'Intervall', hint: 'Runden, Belastung, Pause' },
  { value: 'mobility', label: 'Mobilität', hint: 'Dauer' },
  { value: 'sport', label: 'Sport', hint: 'Dauer' },
  { value: 'other', label: 'Sonstiges', hint: 'Dauer' },
];

const TYPE_LABELS: Record<string, string> = Object.fromEntries(EXERCISE_TYPE_OPTIONS.map((o) => [o.value, o.label]));

export function exerciseTypeLabel(type: ExerciseType): string {
  return TYPE_LABELS[normalizeExerciseType(type)] ?? 'Sonstiges';
}

/** The legacy 'cardio' value predates the typed system. */
export function normalizeExerciseType(type: ExerciseType): Exclude<ExerciseType, 'cardio'> {
  return type === 'cardio' ? 'cardio_distance' : type;
}

export const MUSCLE_GROUP_OPTIONS: { value: MuscleGroup; label: string }[] = [
  { value: 'chest', label: 'Brust' },
  { value: 'back', label: 'Rücken' },
  { value: 'legs', label: 'Beine' },
  { value: 'shoulders', label: 'Schultern' },
  { value: 'biceps', label: 'Bizeps' },
  { value: 'triceps', label: 'Trizeps' },
  { value: 'abs', label: 'Bauch' },
  { value: 'full_body', label: 'Ganzkörper' },
  { value: 'cardio', label: 'Cardio' },
  { value: 'other', label: 'Keine / Sonstige' },
];

export function muscleGroupLabel(group: MuscleGroup): string {
  return MUSCLE_GROUP_OPTIONS.find((o) => o.value === group)?.label ?? group;
}

/** Only types where sets × reps targets make sense in the plan editor. */
export function usesSetTargets(type: ExerciseType): boolean {
  const t = normalizeExerciseType(type);
  return t === 'strength' || t === 'bodyweight';
}

export function isDistanceCardio(type: ExerciseType): boolean {
  return normalizeExerciseType(type) === 'cardio_distance';
}

/** Runs/walks are described by pace (min/km); rides & machines by km/h. */
export function prefersPace(exerciseName: string): boolean {
  return /lauf|jog|walk|geh|wander|treppe|marsch/i.test(exerciseName);
}
