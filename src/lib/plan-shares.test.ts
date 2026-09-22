import { describe, expect, it } from 'vitest';
import { formatActualSummary, shareKindLabel } from './plan-shares';

describe('shareKindLabel', () => {
  it('labels a template/day share', () => {
    expect(shareKindLabel('template')).toBe('Trainingsvorlage');
  });

  it('labels a completed-workout share', () => {
    expect(shareKindLabel('workout')).toBe('Abgeschlossenes Training');
  });
});

describe('formatActualSummary', () => {
  it('is empty when neither duration nor distance is shared', () => {
    expect(formatActualSummary(null, null)).toBe('');
  });

  it('joins duration and distance when both are shared', () => {
    expect(formatActualSummary(1800, 5.2)).toBe('30 Min. · 5,2 km');
  });

  it('shows only the field that was actually shared', () => {
    expect(formatActualSummary(1800, null)).toBe('30 Min.');
    expect(formatActualSummary(null, 5.2)).toBe('5,2 km');
  });
});
