export type SystemEventType = 'workout_started' | 'workout_completed' | 'weekly_goal_reached' | 'challenge_completed';

/** German sentence for an automatic team-activity event. Only ever uses the
 * workout/challenge title and rounded minutes — never health data. */
export function formatSystemEvent(name: string, eventType: string | null, metadata: Record<string, unknown>): string {
  const title = typeof metadata.title === 'string' && metadata.title ? metadata.title : null;
  const minutes = typeof metadata.duration_minutes === 'number' ? metadata.duration_minutes : null;

  switch (eventType) {
    case 'workout_started':
      return title ? `${name} hat „${title}“ gestartet.` : `${name} hat ein Training gestartet.`;
    case 'workout_completed': {
      const base = title ? `${name} hat „${title}“ abgeschlossen` : `${name} hat ein Training abgeschlossen`;
      return minutes && minutes > 0 ? `${base} – ${minutes} Min.` : `${base}.`;
    }
    case 'weekly_goal_reached':
      return `${name} hat das Wochenziel erreicht.`;
    case 'challenge_completed':
      return title ? `${name} hat die Herausforderung „${title}“ abgeschlossen.` : `${name} hat eine Herausforderung abgeschlossen.`;
    default:
      return `${name} war aktiv.`;
  }
}
