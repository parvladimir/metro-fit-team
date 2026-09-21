/**
 * User-facing description of how points are awarded. The NUMBERS come from the
 * team's `team_ranking_rules` row — the same row the scoring functions
 * (award_fitness_score / handle_workout_status_change / recompute_workout_scores)
 * read — so this text can never drift from real scoring. Only the wording lives
 * here. Which event types share the daily cap mirrors `v_capped_types` in
 * award_fitness_score (see supabase/migrations/0006 and the rule test).
 */
export interface PointsRules {
  points_workout_completed: number;
  points_duration_bonus: number;
  duration_bonus_threshold_minutes: number;
  points_weekly_goal_reached: number;
  points_consistency_bonus: number;
  consistency_bonus_min_days: number;
  points_daily_step_goal: number;
  daily_cap_points: number;
}

export type PointsAccent = 'primary' | 'info' | 'gold' | 'success' | 'teal' | 'challenge';

export interface PointsRuleItem {
  key: 'workout' | 'duration' | 'weekly_goal' | 'consistency' | 'steps' | 'challenge';
  title: string;
  detail: string | null;
  /** e.g. "+100"; null when the amount depends on the challenge */
  amount: string | null;
  accent: PointsAccent;
}

/** Event types that count toward the daily cap (mirror of award_fitness_score). */
export const DAILY_CAPPED_EVENTS = ['workout_completed', 'workout_duration_bonus', 'consistency_bonus'] as const;

const plus = (n: number) => `+${n}`;

export function describePointsRules(r: PointsRules): { items: PointsRuleItem[]; capNote: string | null } {
  const items: PointsRuleItem[] = [];
  if (r.points_workout_completed > 0)
    items.push({ key: 'workout', title: 'Training abgeschlossen', detail: null, amount: plus(r.points_workout_completed), accent: 'primary' });
  if (r.points_duration_bonus > 0)
    items.push({ key: 'duration', title: `Training ab ${r.duration_bonus_threshold_minutes} Minuten`, detail: 'Zusatzpunkte für längere Trainings', amount: plus(r.points_duration_bonus), accent: 'info' });
  if (r.points_weekly_goal_reached > 0)
    items.push({ key: 'weekly_goal', title: 'Wochenziel erreicht', detail: 'Du hast dein Wochenziel an Trainings geschafft', amount: plus(r.points_weekly_goal_reached), accent: 'gold' });
  if (r.points_consistency_bonus > 0)
    items.push({ key: 'consistency', title: 'Regelmäßigkeit', detail: `Training an mindestens ${r.consistency_bonus_min_days} verschiedenen Tagen pro Woche`, amount: plus(r.points_consistency_bonus), accent: 'success' });
  if (r.points_daily_step_goal > 0)
    items.push({ key: 'steps', title: 'Tages-Schrittziel erreicht', detail: null, amount: plus(r.points_daily_step_goal), accent: 'teal' });
  items.push({ key: 'challenge', title: 'Challenges', detail: 'Je nach Challenge zusätzliche Punkte', amount: null, accent: 'challenge' });

  const capNote =
    r.daily_cap_points > 0
      ? `Training, Dauer-Bonus und Regelmäßigkeit zählen zusammen höchstens ${r.daily_cap_points} Punkte pro Tag. Wochenziel, Schrittziel und Challenges sind davon ausgenommen.`
      : null;
  return { items, capNote };
}

/** Points that belong to ONE workout (only events linked to it by source id —
 * weekly/consistency bonuses are per week, so they are not attributed to a workout). */
export function describeWorkoutPoints(
  events: { event_type: string; points: number }[],
  r: Pick<PointsRules, 'duration_bonus_threshold_minutes'>
): { lines: { label: string; points: number }[]; total: number } {
  const labelFor = (t: string) => (t === 'workout_completed' ? 'Training abgeschlossen' : t === 'workout_duration_bonus' ? `Training ab ${r.duration_bonus_threshold_minutes} Minuten` : null);
  const lines = events
    .filter((e) => labelFor(e.event_type) !== null && e.points > 0)
    .sort((a, b) => (a.event_type === 'workout_completed' ? -1 : b.event_type === 'workout_completed' ? 1 : 0))
    .map((e) => ({ label: labelFor(e.event_type)!, points: e.points }));
  return { lines, total: lines.reduce((s, l) => s + l.points, 0) };
}
