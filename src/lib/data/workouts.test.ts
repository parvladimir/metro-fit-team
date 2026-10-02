import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
let result: { data: unknown; error: { code?: string } | null };
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => result;
      return q;
    },
  }),
}));

import { getActiveWorkout } from './workouts';

beforeEach(() => {
  result = { data: null, error: null };
});

describe('getActiveWorkout', () => {
  it('a running workout is returned', async () => {
    result = { data: { id: 'w-1', title: 'Push', activity_type: 'krafttraining', started_at: 'x', paused_seconds: 0, paused_at: null }, error: null };
    expect(await getActiveWorkout('user-1')).toMatchObject({ id: 'w-1' });
  });

  it('"there is none" is null …', async () => {
    expect(await getActiveWorkout('user-1')).toBeNull();
  });

  it('… and a failed lookup is NOT the same thing: it is undefined (nobody knows), so nothing downstream may act as if the workout were over', async () => {
    result = { data: null, error: { code: '57014' } };
    expect(await getActiveWorkout('user-1')).toBeUndefined();
  });
});
