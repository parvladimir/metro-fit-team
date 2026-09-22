import { templateExerciseSummary } from '@/lib/plan-templates';
import { formatKm } from '@/lib/workout-metrics';
import { formatPlanDuration } from '@/lib/plan-targets';

export const SHARE_NOTE_MAX_LENGTH = 500;
export const SHARE_TITLE_MAX_LENGTH = 60;

export function shareKindLabel(sourceType: 'template' | 'workout'): string {
  return sourceType === 'workout' ? 'Abgeschlossenes Training' : 'Trainingsvorlage';
}

/** Compact "Bankdrücken · Dips · +2" line for a shared card — same shape a template card uses. */
export const shareExerciseSummary = templateExerciseSummary;

/** "47 Min. · 5,2 km" — only the fields the author explicitly opted to share. */
export function formatActualSummary(durationSeconds: number | null, distanceKm: number | null): string {
  const parts: string[] = [];
  if (durationSeconds != null) parts.push(formatPlanDuration(durationSeconds));
  if (distanceKm != null) parts.push(formatKm(distanceKm));
  return parts.join(' · ');
}
