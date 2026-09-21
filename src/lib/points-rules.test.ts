import { describe, expect, it } from 'vitest';
import { DAILY_CAPPED_EVENTS, describePointsRules, describeWorkoutPoints, type PointsRules } from './points-rules';
import { DELETED_QUOTE_TEXT, quoteFromMessage, quotePreview } from './chat-quote';

// The team's rules exactly as configured in production (team_ranking_rules)
const PROD: PointsRules = {
  points_workout_completed: 100,
  points_duration_bonus: 40,
  duration_bonus_threshold_minutes: 30,
  points_weekly_goal_reached: 150,
  points_consistency_bonus: 20,
  consistency_bonus_min_days: 3,
  points_daily_step_goal: 20,
  daily_cap_points: 200,
};

describe('Punkteverteilung text from the live rules', () => {
  const { items, capNote } = describePointsRules(PROD);
  const by = (k: string) => items.find((i) => i.key === k)!;

  it('shows the production values', () => {
    expect(by('workout')).toMatchObject({ title: 'Training abgeschlossen', amount: '+100' });
    expect(by('duration')).toMatchObject({ title: 'Training ab 30 Minuten', amount: '+40' });
    expect(by('weekly_goal')).toMatchObject({ title: 'Wochenziel erreicht', amount: '+150' });
    expect(by('consistency')).toMatchObject({ title: 'Regelmäßigkeit', amount: '+20' });
    expect(by('consistency').detail).toBe('Training an mindestens 3 verschiedenen Tagen pro Woche');
    expect(by('steps')).toMatchObject({ title: 'Tages-Schrittziel erreicht', amount: '+20' });
    expect(by('challenge')).toMatchObject({ title: 'Challenges', amount: null, detail: 'Je nach Challenge zusätzliche Punkte' });
  });

  it('follows admin changes (no hardcoded numbers)', () => {
    const r = describePointsRules({ ...PROD, points_workout_completed: 80, duration_bonus_threshold_minutes: 45, points_duration_bonus: 25, consistency_bonus_min_days: 4, daily_cap_points: 150 });
    expect(r.items.find((i) => i.key === 'workout')!.amount).toBe('+80');
    expect(r.items.find((i) => i.key === 'duration')!.title).toBe('Training ab 45 Minuten');
    expect(r.items.find((i) => i.key === 'consistency')!.detail).toContain('4 verschiedenen Tagen');
    expect(r.capNote).toContain('150 Punkte');
  });

  it('hides rules that award nothing, keeps the challenge note', () => {
    const r = describePointsRules({ ...PROD, points_daily_step_goal: 0, points_duration_bonus: 0 });
    expect(r.items.map((i) => i.key)).toEqual(['workout', 'weekly_goal', 'consistency', 'challenge']);
  });

  it('daily limit note only when a cap exists and names exactly the capped kinds', () => {
    expect(capNote).toBe('Training, Dauer-Bonus und Regelmäßigkeit zählen zusammen höchstens 200 Punkte pro Tag. Wochenziel, Schrittziel und Challenges sind davon ausgenommen.');
    expect(describePointsRules({ ...PROD, daily_cap_points: 0 }).capNote).toBeNull();
    expect([...DAILY_CAPPED_EVENTS]).toEqual(['workout_completed', 'workout_duration_bonus', 'consistency_bonus']);
  });
});

describe('points for one workout (only linked ledger rows)', () => {
  it('lists completed + duration bonus with a total', () => {
    const r = describeWorkoutPoints([{ event_type: 'workout_duration_bonus', points: 40 }, { event_type: 'workout_completed', points: 100 }], PROD);
    expect(r.lines).toEqual([{ label: 'Training abgeschlossen', points: 100 }, { label: 'Training ab 30 Minuten', points: 40 }]);
    expect(r.total).toBe(140);
  });
  it('never invents lines: weekly/consistency (not per workout) and zero rows are ignored', () => {
    const r = describeWorkoutPoints([{ event_type: 'weekly_goal_reached', points: 150 }, { event_type: 'consistency_bonus', points: 20 }, { event_type: 'workout_completed', points: 0 }], PROD);
    expect(r.lines).toEqual([]);
    expect(r.total).toBe(0);
  });
  it('shows the capped amount actually awarded', () => {
    expect(describeWorkoutPoints([{ event_type: 'workout_completed', points: 60 }], PROD).total).toBe(60);
  });
});

describe('reply quote data', () => {
  it('previews are plain, short and markdown-free', () => {
    expect(quotePreview('**Hallo** [Link](https://a.de)\n\n* Punkt')).toBe('Hallo Link • Punkt');
    const long = quotePreview('x'.repeat(400));
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith('…')).toBe(true);
  });
  it('flags deleted originals and photo originals', () => {
    expect(quoteFromMessage({ id: 'a', authorName: 'Tim A', content: 'x', message_type: 'text', deleted_at: '2026-01-01' }).deleted).toBe(true);
    expect(quoteFromMessage({ id: 'a', authorName: 'Tim A', content: '', message_type: 'image' })).toMatchObject({ isImage: true, deleted: false, preview: '' });
    expect(DELETED_QUOTE_TEXT).toBe('Ursprüngliche Nachricht wurde gelöscht');
  });
});
