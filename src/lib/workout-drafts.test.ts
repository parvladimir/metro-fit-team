import { describe, expect, it } from 'vitest';
import { clearDraft, clearDraftsForUser, clearDraftsForWorkout, draftKey, DRAFT_TTL_MS, readDraft, sweepDrafts, writeDraft, type DraftScope } from './workout-drafts';

/** A minimal in-memory Storage. */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.get(key) ?? null; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, String(value)); }
}

class FullStorage extends MemoryStorage {
  setItem(): void { throw new DOMException('quota', 'QuotaExceededError'); }
}

class BrokenStorage extends MemoryStorage {
  getItem(): string | null { throw new Error('denied'); }
}

const scope = (over: Partial<DraftScope> = {}): DraftScope => ({ userId: 'u1', workoutId: 'w1', workoutExerciseId: 'we1', type: 'strength', ...over });
const NOW = 1_800_000_000_000;

describe('draft scope', () => {
  it('is bound to user, workout, workout-exercise row and input mode', () => {
    const base = draftKey(scope());
    expect(draftKey(scope({ userId: 'u2' }))).not.toBe(base);
    expect(draftKey(scope({ workoutId: 'w2' }))).not.toBe(base);
    expect(draftKey(scope({ workoutExerciseId: 'we2' }))).not.toBe(base);
    expect(draftKey(scope({ type: 'bodyweight' }))).not.toBe(base);
  });
  it('the legacy "cardio" type shares the input mode of distance cardio', () => {
    expect(draftKey(scope({ type: 'cardio' }))).toBe(draftKey(scope({ type: 'cardio_distance' })));
  });
});

describe('writing and restoring a draft', () => {
  it('restores exactly what was typed, including the mode and the open section', () => {
    const st = new MemoryStorage();
    expect(writeDraft(scope(), 'ex1', { values: { weight: '82,5', reps: '8' }, bwMode: 'duration', more: true }, NOW, st)).toBe(true);
    const r = readDraft(scope(), 'ex1', NOW + 1000, st);
    expect(r).toMatchObject({ status: 'ok', draft: { values: { weight: '82,5', reps: '8' }, bwMode: 'duration', more: true } });
  });

  it('stores only the non-empty fields', () => {
    const st = new MemoryStorage();
    writeDraft(scope(), 'ex1', { values: { weight: '80', reps: '', notes: '  ' } }, NOW, st);
    const r = readDraft(scope(), 'ex1', NOW, st);
    expect(r.status === 'ok' && r.draft.values).toEqual({ weight: '80' });
  });

  it('does not stash anything but the inputs (no profile, no credentials)', () => {
    const st = new MemoryStorage();
    writeDraft(scope(), 'ex1', { values: { weight: '80' } }, NOW, st);
    const raw = JSON.parse(st.getItem(draftKey(scope()))!);
    expect(Object.keys(raw).sort()).toEqual(['f', 't', 'v', 'x']);
  });

  it('another exercise row, workout or user never sees it', () => {
    const st = new MemoryStorage();
    writeDraft(scope(), 'ex1', { values: { weight: '80' } }, NOW, st);
    expect(readDraft(scope({ workoutExerciseId: 'we2' }), 'ex1', NOW, st).status).toBe('none');
    expect(readDraft(scope({ workoutId: 'w2' }), 'ex1', NOW, st).status).toBe('none');
    expect(readDraft(scope({ userId: 'u2' }), 'ex1', NOW, st).status).toBe('none');
  });

  it('a row that now holds a different exercise discards the old draft', () => {
    const st = new MemoryStorage();
    writeDraft(scope(), 'ex1', { values: { weight: '80' } }, NOW, st);
    expect(readDraft(scope(), 'ex2', NOW, st)).toEqual({ status: 'discarded', reason: 'incompatible' });
    expect(st.length).toBe(0);
  });

  it('expires abandoned drafts after the documented time', () => {
    const st = new MemoryStorage();
    writeDraft(scope(), 'ex1', { values: { weight: '80' } }, NOW, st);
    expect(readDraft(scope(), 'ex1', NOW + DRAFT_TTL_MS - 1000, st).status).toBe('ok');
    expect(readDraft(scope(), 'ex1', NOW + DRAFT_TTL_MS + 1000, st)).toEqual({ status: 'discarded', reason: 'expired' });
    expect(st.length).toBe(0);
  });

  it('discards an incompatible schema version and corrupt content', () => {
    const st = new MemoryStorage();
    st.setItem(draftKey(scope()), JSON.stringify({ v: 99, t: NOW, x: 'ex1', f: {} }));
    expect(readDraft(scope(), 'ex1', NOW, st)).toEqual({ status: 'discarded', reason: 'incompatible' });
    st.setItem(draftKey(scope()), '{not json');
    expect(readDraft(scope(), 'ex1', NOW, st)).toEqual({ status: 'discarded', reason: 'corrupt' });
    st.setItem(draftKey(scope()), JSON.stringify({ v: 1, t: NOW, x: 'ex1', f: { weight: 80 } }));
    expect(readDraft(scope(), 'ex1', NOW, st)).toEqual({ status: 'discarded', reason: 'corrupt' });
  });

  it('can be cleared', () => {
    const st = new MemoryStorage();
    writeDraft(scope(), 'ex1', { values: { weight: '80' } }, NOW, st);
    clearDraft(scope(), st);
    expect(readDraft(scope(), 'ex1', NOW, st).status).toBe('none');
  });
});

describe('storage that cannot be used', () => {
  it('reports unavailable and never throws, so training keeps working', () => {
    expect(readDraft(scope(), 'ex1', NOW, null)).toEqual({ status: 'unavailable' });
    expect(writeDraft(scope(), 'ex1', { values: { weight: '80' } }, NOW, null)).toBe(false);
    expect(writeDraft(scope(), 'ex1', { values: { weight: '80' } }, NOW, new FullStorage())).toBe(false);
    expect(readDraft(scope(), 'ex1', NOW, new BrokenStorage())).toEqual({ status: 'unavailable' });
    expect(() => clearDraft(scope(), null)).not.toThrow();
    expect(sweepDrafts({ userId: 'u1', activeWorkoutId: 'w1', now: NOW }, null)).toBe(0);
  });
});

describe('clearing drafts', () => {
  function fill(st: Storage) {
    writeDraft(scope(), 'ex1', { values: { weight: '80' } }, NOW, st);
    writeDraft(scope({ workoutExerciseId: 'we2' }), 'ex2', { values: { reps: '10' } }, NOW, st);
    writeDraft(scope({ workoutId: 'w2' }), 'ex1', { values: { weight: '60' } }, NOW, st);
    writeDraft(scope({ userId: 'u2' }), 'ex1', { values: { weight: '50' } }, NOW, st);
    st.setItem('unrelated', 'keep me');
  }

  it('a finished, skipped or discarded workout loses all its drafts and nothing else', () => {
    const st = new MemoryStorage();
    fill(st);
    expect(clearDraftsForWorkout('u1', 'w1', st)).toBe(2);
    expect(readDraft(scope({ workoutId: 'w2' }), 'ex1', NOW, st).status).toBe('ok');
    expect(readDraft(scope({ userId: 'u2' }), 'ex1', NOW, st).status).toBe('ok');
    expect(st.getItem('unrelated')).toBe('keep me');
  });

  it('signing out clears every draft of that user only', () => {
    const st = new MemoryStorage();
    fill(st);
    expect(clearDraftsForUser('u1', st)).toBe(3);
    expect(readDraft(scope({ userId: 'u2' }), 'ex1', NOW, st).status).toBe('ok');
    expect(st.getItem('unrelated')).toBe('keep me');
  });
});

describe('housekeeping sweep', () => {
  it('keeps the running workout\'s fresh drafts and removes everything else', () => {
    const st = new MemoryStorage();
    writeDraft(scope(), 'ex1', { values: { weight: '80' } }, NOW, st); // running workout, fresh
    writeDraft(scope({ workoutExerciseId: 'we2' }), 'ex2', { values: { reps: '10' } }, NOW - DRAFT_TTL_MS - 5000, st); // running workout, expired
    writeDraft(scope({ workoutId: 'w-old' }), 'ex1', { values: { weight: '60' } }, NOW, st); // finished / discarded workout
    writeDraft(scope({ userId: 'someone-else' }), 'ex1', { values: { weight: '50' } }, NOW, st); // another account on this device
    st.setItem('mft:draft:v0:legacy', '{}'); // an older schema
    st.setItem('unrelated', 'keep me');
    expect(sweepDrafts({ userId: 'u1', activeWorkoutId: 'w1', now: NOW }, st)).toBe(4);
    expect(readDraft(scope(), 'ex1', NOW, st).status).toBe('ok');
    expect(st.getItem('unrelated')).toBe('keep me');
    expect(st.length).toBe(2);
  });

  it('with no running workout, every draft of the user goes', () => {
    const st = new MemoryStorage();
    writeDraft(scope(), 'ex1', { values: { weight: '80' } }, NOW, st);
    expect(sweepDrafts({ userId: 'u1', activeWorkoutId: null, now: NOW }, st)).toBe(1);
    expect(st.length).toBe(0);
  });
});
