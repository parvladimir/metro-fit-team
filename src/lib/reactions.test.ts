import { describe, expect, it } from 'vitest';
import {
  applyReactionToggle,
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

describe('applyReactionToggle (idempotent per-user, per-key merge)', () => {
  it('adding the same key twice converges to the same state (retry-safe)', () => {
    let state: ReactionsByUser = {};
    state = applyReactionToggle(state, 'u1', 'fire', true);
    const once = state;
    state = applyReactionToggle(state, 'u1', 'fire', true);
    expect(state).toEqual(once);
    expect(state).toEqual({ u1: ['fire'] });
  });
  it('one user can hold several different keys at once, added one at a time', () => {
    let state: ReactionsByUser = {};
    state = applyReactionToggle(state, 'u1', 'thumbs_up', true);
    state = applyReactionToggle(state, 'u1', 'fire', true);
    state = applyReactionToggle(state, 'u1', 'muscle', true);
    expect(state.u1).toEqual(['thumbs_up', 'fire', 'muscle']);
  });
  it('removing one key leaves the user’s other keys and other users untouched', () => {
    let state: ReactionsByUser = { u1: ['thumbs_up', 'fire', 'muscle'], u2: ['fire'] };
    state = applyReactionToggle(state, 'u1', 'fire', false);
    expect(state).toEqual({ u1: ['thumbs_up', 'muscle'], u2: ['fire'] });
  });
  it('removing a key twice is a no-op the second time', () => {
    let state: ReactionsByUser = { u1: ['fire'] };
    state = applyReactionToggle(state, 'u1', 'fire', false);
    expect(state).toEqual({});
    const empty = state;
    state = applyReactionToggle(state, 'u1', 'fire', false);
    expect(state).toBe(empty);
  });
  it('removing the last key drops the user entry entirely rather than leaving an empty array', () => {
    let state: ReactionsByUser = { u1: ['fire'], u2: ['heart'] };
    state = applyReactionToggle(state, 'u1', 'fire', false);
    expect(state).toEqual({ u2: ['heart'] });
    expect('u1' in state).toBe(false);
  });
});

describe('summarizeReactions', () => {
  it('counts distinct reactions, not distinct people — one person in two counts is not two people', () => {
    // Volodymyr: 👍 + 🔥, Tim: 🔥 — matches the task's own worked example.
    const state: ReactionsByUser = { volodymyr: ['thumbs_up', 'fire'], tim: ['fire'] };
    expect(summarizeReactions(state)).toEqual([
      { key: 'thumbs_up', count: 1 },
      { key: 'fire', count: 2 },
    ]);
  });
  it('nonzero only, in allowlist order regardless of insertion order', () => {
    const state: ReactionsByUser = { u1: ['rocket'], u2: ['thumbs_up'], u3: ['thumbs_up'] };
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
