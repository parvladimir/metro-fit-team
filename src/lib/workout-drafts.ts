import { normalizeExerciseType } from '@/lib/exercise-types';
import type { BodyweightMode, FormValues } from '@/lib/set-form';
import type { ExerciseType } from '@/types/database';

/**
 * Local (this device only) drafts of an unfinished set entry.
 *
 * A draft is never a workout record and is never sent anywhere: it lives in the
 * browser's localStorage so an accidental navigation or a refresh in the middle of
 * a workout does not lose what the user had already typed.
 *
 * Scope of one draft: user + workout + workout-exercise row + input mode (the
 * exercise type decides which inputs exist) + schema version. Rows are addressed by
 * their id, never by a list index or a display name, so reordering or replacing an
 * exercise can never move a draft onto another exercise.
 */
export const DRAFT_SCHEMA_VERSION = 1;
/** Abandoned drafts expire this long after the last edit. */
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

const PREFIX = 'mft:draft:';
const CURRENT_PREFIX = `${PREFIX}v${DRAFT_SCHEMA_VERSION}:`;

export interface DraftScope {
  userId: string;
  workoutId: string;
  workoutExerciseId: string;
  /** The exercise type (normalized) — the input mode. */
  type: ExerciseType;
}

export interface DraftPayload {
  /** Only non-empty inputs. */
  values: FormValues;
  bwMode?: BodyweightMode;
  /** Whether the "Weitere Daten" section was open. */
  more?: boolean;
}

interface StoredDraft {
  v: number;
  t: number;
  /** The exercise the row held when the draft was written. */
  x: string;
  f: FormValues;
  m?: BodyweightMode;
  o?: boolean;
}

export type DraftRead =
  | { status: 'none' }
  | { status: 'unavailable' }
  | { status: 'discarded'; reason: 'expired' | 'incompatible' | 'corrupt' }
  | { status: 'ok'; draft: DraftPayload; savedAt: number };

export function draftKey(scope: DraftScope): string {
  return `${CURRENT_PREFIX}${scope.userId}:${scope.workoutId}:${scope.workoutExerciseId}:${normalizeExerciseType(scope.type)}`;
}

/** The browser's localStorage, or null when it is missing or blocked (private mode,
 * disabled site data, quota). Training must keep working either way. */
export function getDraftStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const probe = `${PREFIX}probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

function isValues(value: unknown): value is FormValues {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === 'string');
}

export function readDraft(scope: DraftScope, exerciseId: string, now: number, storage: Storage | null = getDraftStorage()): DraftRead {
  if (!storage) return { status: 'unavailable' };
  const key = draftKey(scope);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { status: 'unavailable' };
  }
  if (raw == null) return { status: 'none' };

  const discard = (reason: 'expired' | 'incompatible' | 'corrupt'): DraftRead => {
    try {
      storage.removeItem(key);
    } catch {
      /* nothing to do */
    }
    return { status: 'discarded', reason };
  };

  let parsed: StoredDraft;
  try {
    parsed = JSON.parse(raw) as StoredDraft;
  } catch {
    return discard('corrupt');
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.t !== 'number' || !isValues(parsed.f)) return discard('corrupt');
  if (parsed.v !== DRAFT_SCHEMA_VERSION) return discard('incompatible');
  if (now - parsed.t > DRAFT_TTL_MS || parsed.t > now + 60_000) return discard('expired');
  // The row must still hold the exercise the draft was typed for.
  if (parsed.x !== exerciseId) return discard('incompatible');

  const bwMode = parsed.m === 'reps' || parsed.m === 'duration' ? parsed.m : undefined;
  return { status: 'ok', draft: { values: parsed.f, bwMode, more: parsed.o === true }, savedAt: parsed.t };
}

/** Returns false when the draft could not be stored (storage missing or full). */
export function writeDraft(scope: DraftScope, exerciseId: string, payload: DraftPayload, now: number, storage: Storage | null = getDraftStorage()): boolean {
  if (!storage) return false;
  const values: FormValues = {};
  for (const [k, v] of Object.entries(payload.values)) if (typeof v === 'string' && v.trim() !== '') values[k as keyof FormValues] = v;
  const stored: StoredDraft = { v: DRAFT_SCHEMA_VERSION, t: now, x: exerciseId, f: values, m: payload.bwMode, o: payload.more ? true : undefined };
  try {
    storage.setItem(draftKey(scope), JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(scope: DraftScope, storage: Storage | null = getDraftStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(draftKey(scope));
  } catch {
    /* nothing to do */
  }
}

function draftKeys(storage: Storage): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(PREFIX)) keys.push(key);
    }
  } catch {
    /* unreadable storage: nothing to enumerate */
  }
  return keys;
}

function removeAll(storage: Storage, keys: string[]): number {
  let removed = 0;
  for (const key of keys) {
    try {
      storage.removeItem(key);
      removed += 1;
    } catch {
      /* keep going */
    }
  }
  return removed;
}

/** Splits a current-version key back into its scope ids; null for anything else. */
function parseKey(key: string): { userId: string; workoutId: string } | null {
  if (!key.startsWith(CURRENT_PREFIX)) return null;
  const [userId, workoutId] = key.slice(CURRENT_PREFIX.length).split(':');
  return userId && workoutId ? { userId, workoutId } : null;
}

/** Drops every draft of one workout (finished, skipped, discarded). */
export function clearDraftsForWorkout(userId: string, workoutId: string, storage: Storage | null = getDraftStorage()): number {
  if (!storage) return 0;
  return removeAll(
    storage,
    draftKeys(storage).filter((k) => {
      const p = parseKey(k);
      return p?.userId === userId && p.workoutId === workoutId;
    }),
  );
}

/** Drops every draft that belongs to this user (sign-out). */
export function clearDraftsForUser(userId: string, storage: Storage | null = getDraftStorage()): number {
  if (!storage) return 0;
  return removeAll(
    storage,
    draftKeys(storage).filter((k) => parseKey(k)?.userId === userId),
  );
}

/**
 * Housekeeping for the signed-in user. Removes drafts that belong to another account,
 * that are expired or unreadable, that were written by another schema version, and
 * every draft of a workout that is no longer the user's running one (a user has at
 * most one running workout, so finishing, skipping or discarding makes all of that
 * workout's drafts obsolete).
 */
export function sweepDrafts(
  { userId, activeWorkoutId, now }: { userId: string; activeWorkoutId: string | null; now: number },
  storage: Storage | null = getDraftStorage(),
): number {
  if (!storage) return 0;
  const doomed: string[] = [];
  for (const key of draftKeys(storage)) {
    const scope = parseKey(key);
    if (!scope) {
      doomed.push(key); // another schema version, or not ours to keep
      continue;
    }
    if (scope.userId !== userId || scope.workoutId !== activeWorkoutId) {
      doomed.push(key);
      continue;
    }
    try {
      const parsed = JSON.parse(storage.getItem(key) ?? 'null') as StoredDraft | null;
      if (!parsed || typeof parsed.t !== 'number' || now - parsed.t > DRAFT_TTL_MS) doomed.push(key);
    } catch {
      doomed.push(key);
    }
  }
  return removeAll(storage, doomed);
}
