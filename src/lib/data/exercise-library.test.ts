import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

let favoritesResult: { data: unknown; error: { code?: string } | null };
let rpcResult: { data: unknown; error: { code?: string } | null };
let clientFails = false;
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (clientFails) throw new Error('client blew up');
    return {
      from: () => {
        const q: Record<string, unknown> = {};
        q.select = () => q;
        q.order = () => q;
        q.limit = async () => favoritesResult;
        return q;
      },
      rpc: async () => rpcResult,
    };
  },
}));

import { getFavoriteExerciseIds, getRecentExerciseIds, isMissingObject } from './exercise-library';

beforeEach(() => {
  clientFails = false;
  favoritesResult = { data: [], error: null };
  rpcResult = { data: [], error: null };
});

describe('getFavoriteExerciseIds', () => {
  it('returns the favourites in the order stored, without the ones that stopped being visible', async () => {
    favoritesResult = {
      data: [
        { exercise_id: 'a', exercises: { id: 'a' } },
        { exercise_id: 'gone', exercises: null }, // deleted, or its team was left: the bookmark opens nothing
        { exercise_id: 'b', exercises: { id: 'b' } },
      ],
      error: null,
    };
    expect(await getFavoriteExerciseIds()).toEqual({ status: 'ok', ids: ['a', 'b'] });
  });

  it('an empty list is OK and empty — not an error', async () => {
    expect(await getFavoriteExerciseIds()).toEqual({ status: 'ok', ids: [] });
  });

  it('a database without the table yet is "unavailable" (the star and the tab stay hidden)', async () => {
    favoritesResult = { data: null, error: { code: 'PGRST205' } };
    expect(await getFavoriteExerciseIds()).toEqual({ status: 'unavailable' });
    favoritesResult = { data: null, error: { code: '42P01' } };
    expect(await getFavoriteExerciseIds()).toEqual({ status: 'unavailable' });
  });

  it('any other failure is an error, never "no favourites"', async () => {
    favoritesResult = { data: null, error: { code: '42501' } };
    expect(await getFavoriteExerciseIds()).toEqual({ status: 'error' });
    clientFails = true;
    expect(await getFavoriteExerciseIds()).toEqual({ status: 'error' });
  });
});

describe('getRecentExerciseIds', () => {
  it('returns the ids in the order the database gave them', async () => {
    rpcResult = { data: [{ out_exercise_id: 'x' }, { out_exercise_id: 'y' }], error: null };
    expect(await getRecentExerciseIds()).toEqual({ status: 'ok', ids: ['x', 'y'] });
  });

  it('unavailable vs failed', async () => {
    rpcResult = { data: null, error: { code: 'PGRST202' } };
    expect(await getRecentExerciseIds()).toEqual({ status: 'unavailable' });
    rpcResult = { data: null, error: { code: '57014' } };
    expect(await getRecentExerciseIds()).toEqual({ status: 'error' });
  });

  it('knows which codes mean "object missing"', () => {
    for (const code of ['PGRST202', 'PGRST205', '42883', '42P01']) expect(isMissingObject({ code })).toBe(true);
    expect(isMissingObject({ code: '42501' })).toBe(false);
    expect(isMissingObject(undefined)).toBe(false);
  });
});
