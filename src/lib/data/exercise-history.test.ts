import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const rpc = vi.fn();
let clientFails = false;
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (clientFails) throw new Error('client blew up'); // an unexpected exception must not take the page down
    return { rpc: (...a: unknown[]) => rpc(...a) };
  },
}));

import { getExerciseHistory, getLastExerciseResults, HISTORY_PAGE_SIZE, isMissingFunction } from './exercise-history';

beforeEach(() => {
  rpc.mockReset();
  clientFails = false;
});

const row = (over: Record<string, unknown> = {}) => ({
  out_exercise_id: 'ex-1',
  out_workout_id: 'w-1',
  out_workout_exercise_id: 'we-1',
  out_performed_at: '2026-09-27T16:00:00Z',
  out_sets: [{ set_number: 1, weight_kg: 80, reps: 10, distance_km: null, duration_seconds: null, metrics: {} }],
  ...over,
});

describe('getLastExerciseResults', () => {
  it('asks once for the whole workout and maps the answer by exercise', async () => {
    rpc.mockResolvedValue({ data: [row(), row({ out_exercise_id: 'ex-2', out_workout_id: 'w-2', out_workout_exercise_id: 'we-2' })], error: null });
    const res = await getLastExerciseResults('workout-1');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('get_last_exercise_results', { p_workout_id: 'workout-1' });
    expect(res.status).toBe('ok');
    if (res.status === 'ok') {
      expect(Object.keys(res.byExercise).sort()).toEqual(['ex-1', 'ex-2']);
      expect(res.byExercise['ex-1']!.sets[0]).toMatchObject({ weight_kg: 80, reps: 10 });
      expect(res.byExercise['ex-1']!.workoutId).toBe('w-1');
    }
  });

  it('no earlier results is an OK answer with nothing in it — not an error', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await getLastExerciseResults('workout-1')).toEqual({ status: 'ok', byExercise: {} });
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await getLastExerciseResults('workout-1')).toEqual({ status: 'ok', byExercise: {} });
  });

  it('drops a result whose sets carry nothing usable', async () => {
    rpc.mockResolvedValue({ data: [row({ out_sets: null }), row({ out_exercise_id: 'ex-3', out_sets: ['junk'] })], error: null });
    expect(await getLastExerciseResults('workout-1')).toEqual({ status: 'ok', byExercise: {} });
  });

  it('a database without the function yet is "unavailable" (the feature hides itself)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    expect(await getLastExerciseResults('workout-1')).toEqual({ status: 'unavailable' });
    rpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'function does not exist' } });
    expect(await getLastExerciseResults('workout-1')).toEqual({ status: 'unavailable' });
  });

  it('any other failure is an error — never mistaken for "no earlier results"', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
    expect(await getLastExerciseResults('workout-1')).toEqual({ status: 'error' });
    clientFails = true;
    expect(await getLastExerciseResults('workout-1')).toEqual({ status: 'error' });
  });

  it('knows which codes mean "function missing"', () => {
    expect(isMissingFunction({ code: 'PGRST202' })).toBe(true);
    expect(isMissingFunction({ code: '42883' })).toBe(true);
    expect(isMissingFunction({ code: '42501' })).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
  });
});

describe('getExerciseHistory', () => {
  const hrow = (n: number, over: Record<string, unknown> = {}) => ({
    out_workout_id: `w-${n}`,
    out_workout_exercise_id: `we-${n}`,
    out_performed_at: `2026-09-0${n}T10:00:00Z`,
    out_instance_no: 1,
    out_instance_count: 1,
    out_sets: [{ set_number: 1, weight_kg: 70 + n, reps: 10, distance_km: null, duration_seconds: null, metrics: {} }],
    ...over,
  });

  it('requests one bounded page and says whether more may follow', async () => {
    rpc.mockResolvedValue({ data: [1, 2, 3, 4, 5].map((n) => hrow(n)), error: null });
    const res = await getExerciseHistory('ex-1', 'w-current', null);
    expect(rpc).toHaveBeenCalledWith('get_exercise_history', { p_exercise_id: 'ex-1', p_exclude_workout_id: 'w-current', p_limit: HISTORY_PAGE_SIZE, p_before: null });
    expect(res).toMatchObject({ status: 'ok', hasMore: true });
    if (res.status === 'ok') expect(res.entries).toHaveLength(5);
  });

  it('a short page is the end of the history', async () => {
    rpc.mockResolvedValue({ data: [hrow(1), hrow(2)], error: null });
    expect(await getExerciseHistory('ex-1', null, '2026-09-30T00:00:00.000Z')).toMatchObject({ status: 'ok', hasMore: false });
  });

  it('two instances of one workout count as one workout when judging the page size', async () => {
    rpc.mockResolvedValue({ data: [hrow(1), hrow(1, { out_workout_exercise_id: 'we-1b', out_instance_no: 2, out_instance_count: 2 }), hrow(2)], error: null });
    const res = await getExerciseHistory('ex-1', null, null);
    expect(res).toMatchObject({ status: 'ok', hasMore: false });
    if (res.status === 'ok') expect(res.entries.map((e) => e.workoutExerciseId)).toEqual(['we-1', 'we-1b', 'we-2']);
  });

  it('unavailable and failed are different answers', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'x' } });
    expect(await getExerciseHistory('ex-1', null, null)).toEqual({ status: 'unavailable' });
    rpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'timeout' } });
    expect(await getExerciseHistory('ex-1', null, null)).toEqual({ status: 'error' });
  });
});
