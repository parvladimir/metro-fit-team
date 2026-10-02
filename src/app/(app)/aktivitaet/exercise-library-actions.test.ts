import { beforeEach, describe, expect, it, vi } from 'vitest';

const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock('@/lib/data/profile', () => ({ requireAuthUser: async () => ({ id: 'user-1' }) }));
vi.mock('server-only', () => ({}));

interface Script {
  upsert: { error: { code?: string; message?: string } | null };
  delete: { error: { code?: string; message?: string } | null };
  workout: { status: string } | null;
  exercise: { id: string } | null;
  lastPosition: number | null;
  insertError: { code?: string } | null;
  existing: { workout_id: string; exercise_id: string } | null;
}
let script: Script;
const calls: { upsert: unknown[]; delete: unknown[]; insert: Array<Record<string, unknown>> } = { upsert: [], delete: [], insert: [] };

function fakeClient() {
  return {
    from(table: string) {
      const q: Record<string, unknown> = {};
      const state: { eq: Record<string, unknown> } = { eq: {} };
      q.select = () => q;
      q.eq = (k: string, v: unknown) => {
        state.eq[k] = v;
        return q;
      };
      q.order = () => q;
      q.limit = async () => ({ data: script.lastPosition == null ? [] : [{ position: script.lastPosition }] });
      q.maybeSingle = async () => {
        if (table === 'workouts') return { data: script.workout };
        if (table === 'exercises') return { data: script.exercise };
        return { data: script.existing }; // workout_exercises lookup of an existing row
      };
      q.upsert = async (row: unknown, opts: unknown) => {
        calls.upsert.push({ row, opts });
        return script.upsert;
      };
      q.delete = () => {
        const d: Record<string, unknown> = {};
        d.eq = (k: string, v: unknown) => {
          state.eq[k] = v;
          return state.eq.exercise_id !== undefined && state.eq.user_id !== undefined ? Promise.resolve((calls.delete.push({ table, ...state.eq }), script.delete)) : d;
        };
        return d;
      };
      q.insert = async (row: Record<string, unknown>) => {
        calls.insert.push(row);
        return { error: script.insertError };
      };
      return q;
    },
  };
}
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fakeClient() }));

import { addExerciseToWorkoutAction, setExerciseFavoriteAction } from './exercise-library-actions';

const id = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const WORKOUT = id(1);
const EX = id(2);
const REQ = id(3);

beforeEach(() => {
  revalidatePath.mockReset();
  calls.upsert.length = 0;
  calls.delete.length = 0;
  calls.insert.length = 0;
  script = { upsert: { error: null }, delete: { error: null }, workout: { status: 'laeuft' }, exercise: { id: EX }, lastPosition: 4, insertError: null, existing: null };
});

describe('setExerciseFavoriteAction', () => {
  it('adds a favourite for the caller only — "already a favourite" is a success', async () => {
    expect(await setExerciseFavoriteAction({ exerciseId: EX, favorite: true })).toEqual({ ok: true });
    expect(calls.upsert[0]).toEqual({ row: { user_id: 'user-1', exercise_id: EX }, opts: { onConflict: 'user_id,exercise_id', ignoreDuplicates: true } });
  });

  it('removes only the caller\'s own row', async () => {
    expect(await setExerciseFavoriteAction({ exerciseId: EX, favorite: false })).toEqual({ ok: true });
    expect(calls.delete).toEqual([{ table: 'exercise_favorites', user_id: 'user-1', exercise_id: EX }]);
  });

  it('refuses a malformed id before touching the database', async () => {
    expect(await setExerciseFavoriteAction({ exerciseId: 'nope', favorite: true })).toMatchObject({ ok: false });
    expect(calls.upsert).toHaveLength(0);
  });

  it.each([
    [{ code: '42501', message: 'new row violates row-level security policy' }, 'nicht verfügbar'],
    [{ code: '23503', message: 'fk' }, 'nicht verfügbar'],
    [{ code: '23514', message: 'favorite_limit_reached' }, 'maximale Anzahl'],
    [{ code: 'PGRST205', message: 'no table' }, 'noch nicht verfügbar'],
    [{ code: 'XX000', message: 'secret internal detail' }, 'konnte nicht gespeichert'],
  ])('maps the database refusal %j to a clear message', async (error, fragment) => {
    script.upsert = { error };
    const res = await setExerciseFavoriteAction({ exerciseId: EX, favorite: true });
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toContain(fragment);
    expect((res as { error: string }).error).not.toContain('secret');
  });
});

describe('addExerciseToWorkoutAction', () => {
  it('appends the exercise at the end of the running workout under the client-chosen id', async () => {
    const res = await addExerciseToWorkoutAction({ workoutId: WORKOUT, exerciseId: EX, requestId: REQ });
    expect(res).toEqual({ ok: true, workoutExerciseId: REQ, replayed: false });
    expect(calls.insert[0]).toEqual({ id: REQ, workout_id: WORKOUT, exercise_id: EX, position: 5 });
    expect(revalidatePath).toHaveBeenCalledWith(`/aktivitaet/training/${WORKOUT}`);
  });

  it('starts at position 0 in an empty workout', async () => {
    script.lastPosition = null;
    await addExerciseToWorkoutAction({ workoutId: WORKOUT, exerciseId: EX, requestId: REQ });
    expect(calls.insert[0]!.position).toBe(0);
  });

  it('a repeated request (double tap, lost response) is answered as done, not added twice', async () => {
    script.insertError = { code: '23505' };
    script.existing = { workout_id: WORKOUT, exercise_id: EX };
    expect(await addExerciseToWorkoutAction({ workoutId: WORKOUT, exerciseId: EX, requestId: REQ })).toEqual({ ok: true, workoutExerciseId: REQ, replayed: true });
    script.existing = { workout_id: id(9), exercise_id: EX }; // the id belongs to another workout's row
    expect(await addExerciseToWorkoutAction({ workoutId: WORKOUT, exerciseId: EX, requestId: REQ })).toMatchObject({ ok: false });
  });

  it('only into the caller\'s own RUNNING workout, and only an exercise the caller may use', async () => {
    script.workout = null;
    expect(await addExerciseToWorkoutAction({ workoutId: WORKOUT, exerciseId: EX, requestId: REQ })).toMatchObject({ ok: false });
    for (const status of ['abgeschlossen', 'uebersprungen', 'geplant']) {
      script.workout = { status };
      expect(await addExerciseToWorkoutAction({ workoutId: WORKOUT, exerciseId: EX, requestId: REQ }), status).toEqual({ ok: false, error: 'Dieses Training ist bereits beendet.' });
    }
    script.workout = { status: 'laeuft' };
    script.exercise = null; // someone else's private exercise is invisible: the foreign key alone would have accepted it
    expect(await addExerciseToWorkoutAction({ workoutId: WORKOUT, exerciseId: EX, requestId: REQ })).toEqual({ ok: false, error: 'Diese Übung ist für dich nicht verfügbar.' });
    expect(calls.insert).toHaveLength(0);
  });

  it('refuses malformed ids', async () => {
    expect(await addExerciseToWorkoutAction({ workoutId: 'x', exerciseId: EX, requestId: REQ })).toMatchObject({ ok: false });
    expect(await addExerciseToWorkoutAction({ workoutId: WORKOUT, exerciseId: EX, requestId: 'x' })).toMatchObject({ ok: false });
    expect(calls.insert).toHaveLength(0);
  });
});
