import { describe, expect, it } from 'vitest';
import { computeElapsedSeconds, isLongWorkout, needsGentleReminder, LONG_WORKOUT_CONFIRM_MINUTES, LONG_WORKOUT_REMINDER_MINUTES } from './workout-timer';

describe('computeElapsedSeconds', () => {
  const now = new Date('2024-01-10T12:00:00Z');

  it('is wall-clock time since start when never paused', () => {
    expect(
      computeElapsedSeconds({ startedAt: '2024-01-10T11:00:00Z', pausedSeconds: 0, pausedAt: null, now })
    ).toBe(3600);
  });

  it('subtracts completed pause time', () => {
    expect(
      computeElapsedSeconds({ startedAt: '2024-01-10T11:00:00Z', pausedSeconds: 600, pausedAt: null, now })
    ).toBe(3000);
  });

  it('also subtracts a still-open pause, up to now', () => {
    // Started 1h ago, paused for the last 10 minutes (still paused).
    expect(
      computeElapsedSeconds({ startedAt: '2024-01-10T11:00:00Z', pausedSeconds: 0, pausedAt: '2024-01-10T11:50:00Z', now })
    ).toBe(3000);
  });

  it('never goes negative', () => {
    expect(
      computeElapsedSeconds({ startedAt: '2024-01-10T11:59:59Z', pausedSeconds: 9999, pausedAt: null, now })
    ).toBe(0);
  });
});

describe('thresholds', () => {
  it('gentle reminder engages at 120 minutes, not before', () => {
    expect(needsGentleReminder(LONG_WORKOUT_REMINDER_MINUTES * 60 - 1)).toBe(false);
    expect(needsGentleReminder(LONG_WORKOUT_REMINDER_MINUTES * 60)).toBe(true);
  });

  it('mandatory confirmation engages at 180 minutes, not before', () => {
    expect(isLongWorkout(LONG_WORKOUT_CONFIRM_MINUTES * 60 - 1)).toBe(false);
    expect(isLongWorkout(LONG_WORKOUT_CONFIRM_MINUTES * 60)).toBe(true);
  });
});
