import { formatDurationWords } from '@/lib/workout-metrics';

export type SystemEventType = 'workout_started' | 'workout_completed' | 'weekly_goal_reached' | 'challenge_completed';

/** German sentence for an automatic team-activity event's first line (title/
 * action only). Only ever uses the workout/challenge title — never health
 * data, never a duration (that belongs on the card's secondary line, see
 * formatSystemEventDuration, so the card stays compact: title on line one,
 * date/time + duration on line two). */
export function formatSystemEvent(name: string, eventType: string | null, metadata: Record<string, unknown>): string {
  const title = typeof metadata.title === 'string' && metadata.title ? metadata.title : null;

  switch (eventType) {
    case 'workout_started':
      return title ? `${name} hat „${title}“ gestartet.` : `${name} hat ein Training gestartet.`;
    case 'workout_completed':
      return title ? `${name} hat „${title}“ abgeschlossen.` : `${name} hat ein Training abgeschlossen.`;
    case 'weekly_goal_reached':
      return `${name} hat das Wochenziel erreicht.`;
    case 'challenge_completed':
      return title ? `${name} hat die Herausforderung „${title}“ abgeschlossen.` : `${name} hat eine Herausforderung abgeschlossen.`;
    default:
      return `${name} war aktiv.`;
  }
}

/** Duration fragment for a workout_completed event's secondary line, e.g.
 * "1 Std. 26 Min." or "45 Min. (korrigiert)" when the saved duration was
 * manually corrected rather than timer-derived. Null when there's no known
 * duration (nothing to show — never invents one). */
export function formatSystemEventDuration(metadata: Record<string, unknown>): string | null {
  const minutes = typeof metadata.duration_minutes === 'number' ? metadata.duration_minutes : null;
  if (!minutes || minutes <= 0) return null;
  const duration = formatDurationWords(minutes * 60);
  return metadata.duration_source === 'corrected' ? `${duration} (korrigiert)` : duration;
}
