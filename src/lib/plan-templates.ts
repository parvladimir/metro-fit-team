import type { MuscleGroup } from '@/types/database';
import { muscleGroupLabel } from '@/lib/exercise-types';

export const TEMPLATE_NAME_MAX_LENGTH = 60;

export function sanitizeTemplateName(raw: string): string {
  return raw.trim().slice(0, TEMPLATE_NAME_MAX_LENGTH);
}

/** Sensible default when the user leaves the name blank: the muscle group(s)
 * the exercises cover, e.g. "Trizeps" or "Brust & Trizeps", or a generic
 * label once there are too many to name individually. */
export function defaultTemplateName(muscleGroups: MuscleGroup[]): string {
  if (muscleGroups.length === 0) return 'Neue Vorlage';
  const unique = Array.from(new Set(muscleGroups));
  if (unique.every((g) => g === 'cardio')) return 'Cardio';
  if (unique.length === 1) return muscleGroupLabel(unique[0]!);
  if (unique.length === 2) return `${muscleGroupLabel(unique[0]!)} & ${muscleGroupLabel(unique[1]!)}`;
  return 'Ganzkörper';
}

/** Compact "Bankdrücken · Dips · +2" line for a template card. */
export function templateExerciseSummary(items: { exercise_name: string }[], max = 3): string {
  if (items.length === 0) return '';
  const names = items.slice(0, max).map((i) => i.exercise_name);
  const extra = items.length - names.length;
  return extra > 0 ? `${names.join(' · ')} · +${extra}` : names.join(' · ');
}

/** How many of a template's items still point at an existing exercise. */
export function usableItemCount(items: { exercise_id: string | null }[]): number {
  return items.filter((i) => i.exercise_id != null).length;
}

export function hasRemovedExercises(items: { exercise_id: string | null }[]): boolean {
  return items.some((i) => i.exercise_id == null);
}
