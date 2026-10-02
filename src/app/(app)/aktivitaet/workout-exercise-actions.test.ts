import { beforeEach, describe, expect, it, vi } from 'vitest';

const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock('@/lib/data/profile', () => ({ requireAuthUser: async () => ({ id: 'user-1' }) }));

const rpc = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));
const getExerciseHistory = vi.fn();
vi.mock('@/lib/data/exercise-history', () => ({ getExerciseHistory: (...a: unknown[]) => getExerciseHistory(...a) }));

import { loadExerciseHistoryAction, postponeExerciseAction, replaceExerciseAction } from './workout-exercise-actions';

const id = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const WORKOUT = id(1);
const ROW = id(2);
const NEW_EX = id(3);
const REQ = id(4);
const input = { workoutId: WORKOUT, workoutExerciseId: ROW, newExerciseId: NEW_EX, requestId: REQ };

beforeEach(() => {
  rpc.mockReset();
  getExerciseHistory.mockReset();
  revalidatePath.mockReset();
});

describe('replaceExerciseAction', () => {
  it('hands the four ids to the database function and reports what happened', async () => {
    rpc.mockResolvedValue({ data: [{ out_mode: 'added', out_workout_exercise_id: REQ, out_removed_workout_exercise_id: null, out_replayed: false }], error: null });
    const res = await replaceExerciseAction(input);
    expect(rpc).toHaveBeenCalledWith('replace_workout_exercise', { p_workout_exercise_id: ROW, p_new_exercise_id: NEW_EX, p_new_workout_exercise_id: REQ });
    expect(res).toEqual({ ok: true, mode: 'added', newWorkoutExerciseId: REQ, removedWorkoutExerciseId: null, replayed: false });
    expect(revalidatePath).toHaveBeenCalledWith(`/aktivitaet/training/${WORKOUT}`);
  });

  it('reports a replacement and a repeated request', async () => {
    rpc.mockResolvedValue({ data: [{ out_mode: 'replaced', out_workout_exercise_id: REQ, out_removed_workout_exercise_id: ROW, out_replayed: true }], error: null });
    expect(await replaceExerciseAction(input)).toEqual({ ok: true, mode: 'replaced', newWorkoutExerciseId: REQ, removedWorkoutExerciseId: ROW, replayed: true });
  });

  it('refuses malformed ids without calling the database', async () => {
    expect(await replaceExerciseAction({ ...input, newExerciseId: 'x' })).toMatchObject({ ok: false });
    expect(await replaceExerciseAction({ ...input, requestId: "'; drop table" })).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['exercise_not_found', 'nicht mehr'],
    ['workout_not_active', 'bereits beendet'],
    ['exercise_not_accessible', 'nicht verfügbar'],
    ['same_exercise', 'bereits die aktuelle Übung'],
    ['invalid_request', 'nicht verarbeitet'],
  ])('turns the database reason %s into a clear German message', async (reason, fragment) => {
    rpc.mockResolvedValue({ data: null, error: { message: reason, code: 'P0001' } });
    const res = await replaceExerciseAction(input);
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toContain(fragment);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('a database that does not have the function yet is not shown as a mystery failure', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Could not find the function', code: 'PGRST202' } });
    expect(await replaceExerciseAction(input)).toEqual({ ok: false, error: 'Diese Funktion ist noch nicht verfügbar.' });
  });

  it('any other failure gets a generic message and leaks no internals', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'relation "x" does not exist: secret detail', code: '42P01' } });
    expect(await replaceExerciseAction(input)).toEqual({ ok: false, error: 'Übung konnte nicht ersetzt werden.' });
  });
});

describe('postponeExerciseAction', () => {
  it('moves the exercise and says whether anything changed', async () => {
    rpc.mockResolvedValue({ data: [{ out_changed: true }], error: null });
    expect(await postponeExerciseAction({ workoutId: WORKOUT, workoutExerciseId: ROW })).toEqual({ ok: true, changed: true });
    expect(rpc).toHaveBeenCalledWith('postpone_workout_exercise', { p_workout_exercise_id: ROW });
    rpc.mockResolvedValue({ data: [{ out_changed: false }], error: null });
    expect(await postponeExerciseAction({ workoutId: WORKOUT, workoutExerciseId: ROW })).toEqual({ ok: true, changed: false });
  });

  it('refuses a finished workout with a clear message and a malformed id outright', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'workout_not_active', code: '22023' } });
    expect(await postponeExerciseAction({ workoutId: WORKOUT, workoutExerciseId: ROW })).toEqual({ ok: false, error: 'Dieses Training ist bereits beendet.' });
    rpc.mockClear();
    expect(await postponeExerciseAction({ workoutId: WORKOUT, workoutExerciseId: 'nope' })).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('loadExerciseHistoryAction', () => {
  it('passes the page position through and returns the entries', async () => {
    getExerciseHistory.mockResolvedValue({ status: 'ok', entries: [{ workoutId: id(5) }], hasMore: true });
    const res = await loadExerciseHistoryAction({ exerciseId: NEW_EX, excludeWorkoutId: WORKOUT, before: '2026-09-27T16:00:00Z' });
    expect(getExerciseHistory).toHaveBeenCalledWith(NEW_EX, WORKOUT, '2026-09-27T16:00:00.000Z');
    expect(res).toEqual({ ok: true, entries: [{ workoutId: id(5) }], hasMore: true });
  });

  it('ignores a "before" that is not a date and refuses malformed ids', async () => {
    getExerciseHistory.mockResolvedValue({ status: 'ok', entries: [], hasMore: false });
    await loadExerciseHistoryAction({ exerciseId: NEW_EX, excludeWorkoutId: WORKOUT, before: 'garbage' });
    expect(getExerciseHistory).toHaveBeenCalledWith(NEW_EX, WORKOUT, null);
    expect(await loadExerciseHistoryAction({ exerciseId: 'x', excludeWorkoutId: WORKOUT })).toMatchObject({ ok: false });
  });

  it('a failed lookup is an error, not an empty history', async () => {
    getExerciseHistory.mockResolvedValue({ status: 'error' });
    expect(await loadExerciseHistoryAction({ exerciseId: NEW_EX, excludeWorkoutId: WORKOUT })).toEqual({ ok: false, error: 'Der Verlauf konnte nicht geladen werden.' });
    getExerciseHistory.mockResolvedValue({ status: 'unavailable' });
    expect(await loadExerciseHistoryAction({ exerciseId: NEW_EX, excludeWorkoutId: WORKOUT })).toEqual({ ok: false, error: 'Diese Funktion ist noch nicht verfügbar.' });
  });
});
