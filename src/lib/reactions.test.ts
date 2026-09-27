import { describe, expect, it } from 'vitest';
import {
  applyReactionChange,
  emojiFor,
  isReactionKey,
  QUICK_REACTIONS,
  REACTIONS,
  reactionText,
  summarizeReactions,
  type ReactionsByUser,
} from './reactions';

describe('allowlist', () => {
  it('has exactly 20 stable reactions', () => {
    expect(REACTIONS).toHaveLength(20);
    expect(new Set(REACTIONS.map((r) => r.key)).size).toBe(20);
  });
  it('quick reactions are the first 6, derived rather than hand-maintained', () => {
    expect(QUICK_REACTIONS).toEqual(REACTIONS.slice(0, 6).map((r) => r.key));
    expect(QUICK_REACTIONS).toHaveLength(6);
  });
  it('resolves a known id and rejects an unknown one', () => {
    expect(isReactionKey('fire')).toBe(true);
    expect(isReactionKey('support')).toBe(false);
    expect(isReactionKey(undefined)).toBe(false);
    expect(emojiFor('fire')).toBe('🔥');
    expect(emojiFor('nonsense')).toBe('❤️');
  });
});

describe('applyReactionChange (idempotent per-user merge)', () => {
  it('setting the same key twice converges to the same state (retry-safe)', () => {
    let state: ReactionsByUser = {};
    state = applyReactionChange(state, 'u1', 'fire');
    const once = state;
    state = applyReactionChange(state, 'u1', 'fire');
    expect(state).toEqual(once);
    expect(state).toEqual({ u1: 'fire' });
  });
  it('replaces one user’s key without touching others', () => {
    let state: ReactionsByUser = { u1: 'fire', u2: 'heart' };
    state = applyReactionChange(state, 'u1', 'muscle');
    expect(state).toEqual({ u1: 'muscle', u2: 'heart' });
  });
  it('removing (null) twice is a no-op the second time', () => {
    let state: ReactionsByUser = { u1: 'fire' };
    state = applyReactionChange(state, 'u1', null);
    expect(state).toEqual({});
    const empty = state;
    state = applyReactionChange(state, 'u1', null);
    expect(state).toBe(empty);
  });
});

describe('summarizeReactions', () => {
  it('counts per key, nonzero only, in allowlist order regardless of insertion order', () => {
    const state: ReactionsByUser = { u1: 'rocket', u2: 'thumbs_up', u3: 'thumbs_up' };
    expect(summarizeReactions(state)).toEqual([
      { key: 'thumbs_up', count: 2 },
      { key: 'rocket', count: 1 },
    ]);
  });
  it('empty state yields no chips', () => {
    expect(summarizeReactions({})).toEqual([]);
  });
});

describe('reactionText', () => {
  it('workout target, with and without a title', () => {
    expect(reactionText('Tim Aigner', 'muscle', true, 'Beine')).toBe('Tim hat mit 💪 auf dein Training „Beine“ reagiert.');
    expect(reactionText('Tim Aigner', 'muscle', true)).toBe('Tim hat mit 💪 auf dein Training reagiert.');
  });
  it('ordinary message target never mentions a training title', () => {
    expect(reactionText('Tim Aigner', 'fire', false)).toBe('Tim hat mit 🔥 auf deine Nachricht reagiert.');
  });
  it('defaults to a workout target when isWorkoutEvent is omitted (historical data)', () => {
    expect(reactionText('Tim Aigner', 'heart')).toBe('Tim hat mit ❤️ auf dein Training reagiert.');
  });
});
