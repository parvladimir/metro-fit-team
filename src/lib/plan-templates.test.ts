import { describe, expect, it } from 'vitest';
import {
  TEMPLATE_NAME_MAX_LENGTH,
  defaultTemplateName,
  hasRemovedExercises,
  sanitizeTemplateName,
  templateExerciseSummary,
  usableItemCount,
} from './plan-templates';

describe('sanitizeTemplateName', () => {
  it('trims whitespace', () => {
    expect(sanitizeTemplateName('  Brust & Trizeps  ')).toBe('Brust & Trizeps');
  });

  it('caps very long names at the max length', () => {
    const long = 'x'.repeat(200);
    expect(sanitizeTemplateName(long)).toHaveLength(TEMPLATE_NAME_MAX_LENGTH);
  });

  it('returns an empty string for blank input, so callers fall back to a default', () => {
    expect(sanitizeTemplateName('   ')).toBe('');
  });
});

describe('defaultTemplateName', () => {
  it('names a single-muscle-group plan after that group', () => {
    expect(defaultTemplateName(['triceps', 'triceps'])).toBe('Trizeps');
    expect(defaultTemplateName(['legs'])).toBe('Beine');
  });

  it('joins two distinct groups, matching the "Brust & Trizeps" example', () => {
    expect(defaultTemplateName(['chest', 'chest', 'triceps'])).toBe('Brust & Trizeps');
  });

  it('falls back to "Ganzkörper" for three or more distinct groups', () => {
    expect(defaultTemplateName(['chest', 'legs', 'back'])).toBe('Ganzkörper');
  });

  it('names an all-cardio plan "Cardio"', () => {
    expect(defaultTemplateName(['cardio', 'cardio'])).toBe('Cardio');
  });

  it('names a plan with zero exercises "Neue Vorlage"', () => {
    expect(defaultTemplateName([])).toBe('Neue Vorlage');
  });
});

describe('templateExerciseSummary', () => {
  it('is empty for a template with zero exercises', () => {
    expect(templateExerciseSummary([])).toBe('');
  });

  it('joins names with a middle dot', () => {
    const items = [{ exercise_name: 'Bankdrücken' }, { exercise_name: 'Dips' }];
    expect(templateExerciseSummary(items)).toBe('Bankdrücken · Dips');
  });

  it('caps the list and appends a remainder count', () => {
    const items = ['A', 'B', 'C', 'D', 'E'].map((n) => ({ exercise_name: n }));
    expect(templateExerciseSummary(items, 3)).toBe('A · B · C · +2');
  });
});

describe('usableItemCount / hasRemovedExercises', () => {
  it('counts only items whose exercise still exists', () => {
    const items = [{ exercise_id: 'a' }, { exercise_id: null }, { exercise_id: 'b' }];
    expect(usableItemCount(items)).toBe(2);
    expect(hasRemovedExercises(items)).toBe(true);
  });

  it('reports no removed exercises when every item still resolves', () => {
    const items = [{ exercise_id: 'a' }, { exercise_id: 'b' }];
    expect(usableItemCount(items)).toBe(2);
    expect(hasRemovedExercises(items)).toBe(false);
  });
});
