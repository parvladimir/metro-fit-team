import { describe, expect, it } from 'vitest';
import { formatSystemEvent, formatSystemEventDuration } from './chat-events';

describe('formatSystemEvent', () => {
  it('started with and without title', () => {
    expect(formatSystemEvent('Volodymyr', 'workout_started', { title: 'Brust & Trizeps' })).toBe('Volodymyr hat „Brust & Trizeps“ gestartet.');
    expect(formatSystemEvent('Thorsten', 'workout_started', {})).toBe('Thorsten hat ein Training gestartet.');
  });
  it('completed never carries the duration on the title line — that belongs on the secondary line', () => {
    expect(formatSystemEvent('Tim', 'workout_completed', { duration_minutes: 54 })).toBe('Tim hat ein Training abgeschlossen.');
    expect(formatSystemEvent('Tim', 'workout_completed', { title: 'Push B', duration_minutes: 54 })).toBe('Tim hat „Push B“ abgeschlossen.');
  });
  it('weekly goal + challenge', () => {
    expect(formatSystemEvent('Tim', 'weekly_goal_reached', {})).toBe('Tim hat das Wochenziel erreicht.');
    expect(formatSystemEvent('Tim', 'challenge_completed', { title: '4 Trainings' })).toBe('Tim hat die Herausforderung „4 Trainings“ abgeschlossen.');
  });
});

describe('formatSystemEventDuration', () => {
  it('formats minutes in words, never a bare oversized minute count', () => {
    expect(formatSystemEventDuration({ duration_minutes: 54 })).toBe('54 Min.');
    expect(formatSystemEventDuration({ duration_minutes: 435 })).toBe('7 Std. 15 Min.');
    expect(formatSystemEventDuration({ duration_minutes: 120 })).toBe('2 Std.');
  });
  it('marks a manually corrected duration without hiding it', () => {
    expect(formatSystemEventDuration({ duration_minutes: 45, duration_source: 'corrected' })).toBe('45 Min. (korrigiert)');
    expect(formatSystemEventDuration({ duration_minutes: 45, duration_source: 'timer' })).toBe('45 Min.');
  });
  it('is null when there is no known duration — never invents one', () => {
    expect(formatSystemEventDuration({})).toBeNull();
    expect(formatSystemEventDuration({ duration_minutes: 0 })).toBeNull();
  });
});
