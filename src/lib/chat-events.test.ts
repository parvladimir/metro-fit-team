import { describe, expect, it } from 'vitest';
import { formatSystemEvent } from './chat-events';

describe('formatSystemEvent', () => {
  it('started with and without title', () => {
    expect(formatSystemEvent('Volodymyr', 'workout_started', { title: 'Brust & Trizeps' })).toBe('Volodymyr hat „Brust & Trizeps“ gestartet.');
    expect(formatSystemEvent('Thorsten', 'workout_started', {})).toBe('Thorsten hat ein Training gestartet.');
  });
  it('completed with duration', () => {
    expect(formatSystemEvent('Tim', 'workout_completed', { duration_minutes: 54 })).toBe('Tim hat ein Training abgeschlossen – 54 Min.');
  });
  it('weekly goal + challenge', () => {
    expect(formatSystemEvent('Tim', 'weekly_goal_reached', {})).toBe('Tim hat das Wochenziel erreicht.');
    expect(formatSystemEvent('Tim', 'challenge_completed', { title: '4 Trainings' })).toBe('Tim hat die Herausforderung „4 Trainings“ abgeschlossen.');
  });
});
