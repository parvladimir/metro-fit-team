import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));
vi.mock('@/lib/data/profile', () => ({ requireAuthUser: async () => ({ id: 'user-1' }) }));
vi.mock('@/lib/server/push', () => ({ notifyEventOwner: vi.fn(), notifyMentionedUsers: vi.fn(), notifyTeamOfNewChatMessage: vi.fn() }));
vi.mock('@/lib/server/mentions', () => ({ parseMentionIds: vi.fn(), syncMentions: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/creator', () => ({ fetchCreators: vi.fn(async () => new Map()) }));

const getMessagesPage = vi.fn();
vi.mock('@/lib/data/chat', () => ({
  getMessagesPage: (...a: unknown[]) => getMessagesPage(...a),
  getEventReplies: vi.fn(async () => ({})),
  getMessageReactions: vi.fn(async () => ({})),
  getMessageMentions: vi.fn(async () => ({})),
  getQuotes: vi.fn(async () => ({})),
}));
vi.mock('@/lib/data/plan-shares', () => ({ getPlanSharesForViewer: vi.fn(async () => ({})) }));
vi.mock('@/lib/data/training-invites', () => ({ getTrainingInvitesForViewer: vi.fn(async () => ({})) }));

let target: { created_at: string } | null;
let between: number | null;
const filters: Array<[string, string, unknown]> = [];
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      let head = false;
      q.select = (_c?: string, opts?: { head?: boolean }) => {
        head = !!opts?.head;
        return q;
      };
      for (const op of ['eq', 'is', 'gte', 'lt']) {
        q[op] = (col: string, val: unknown) => {
          filters.push([op, col, val]);
          return q;
        };
      }
      q.maybeSingle = async () => ({ data: target });
      q.then = (resolve: (v: unknown) => void) => resolve(head ? { count: between } : { data: null });
      return q;
    },
  }),
}));

import { loadMessagesUntilAction } from './actions';

const T = '11111111-1111-4111-8111-111111111111';
const MSG = '22222222-2222-4222-8222-222222222222';
const BEFORE = '2026-10-02T10:00:00.000Z';
const page = (n: number) => ({ messages: Array.from({ length: n }, (_, i) => ({ id: `m${i}`, message_type: 'text' })), hasMore: true });

beforeEach(() => {
  getMessagesPage.mockReset();
  filters.length = 0;
  target = { created_at: '2026-09-01T10:00:00.000Z' };
  between = 130;
});

describe('loadMessagesUntilAction', () => {
  it('loads everything between what is on screen and the target in ONE page, newest side first', async () => {
    getMessagesPage.mockResolvedValue(page(130));
    const res = await loadMessagesUntilAction(T, MSG, BEFORE);
    expect(getMessagesPage).toHaveBeenCalledWith(T, { before: BEFORE, limit: 130 });
    expect(res.reached).toBe(true);
    expect(res.messages).toHaveLength(130);
    expect(res.hasMore).toBe(true);
  });

  it('only counts and loads what is older than the screen and not older than the target', async () => {
    getMessagesPage.mockResolvedValue(page(1));
    await loadMessagesUntilAction(T, MSG, BEFORE);
    expect(filters).toContainEqual(['gte', 'created_at', '2026-09-01T10:00:00.000Z']);
    expect(filters).toContainEqual(['lt', 'created_at', BEFORE]);
    expect(filters).toContainEqual(['eq', 'team_id', T]);
    expect(filters.filter(([, col]) => col === 'deleted_at' || col === 'parent_message_id').length).toBeGreaterThanOrEqual(4); // target and count: top-level, not deleted
  });

  it('is bounded: a target very far back comes in chunks, and says it has not been reached yet', async () => {
    between = 5000;
    getMessagesPage.mockResolvedValue(page(400));
    const res = await loadMessagesUntilAction(T, MSG, BEFORE);
    expect(getMessagesPage).toHaveBeenCalledWith(T, { before: BEFORE, limit: 400 });
    expect(res.reached).toBe(false);
  });

  it('a target the caller cannot read (other team, deleted, a reply, unknown) loads nothing', async () => {
    target = null;
    const res = await loadMessagesUntilAction(T, MSG, BEFORE);
    expect(res).toMatchObject({ messages: [], reached: false, hasMore: false });
    expect(getMessagesPage).not.toHaveBeenCalled();
  });

  it('malformed input never reaches the database', async () => {
    expect((await loadMessagesUntilAction('nope', MSG, BEFORE)).reached).toBe(false);
    expect((await loadMessagesUntilAction(T, 'nope', BEFORE)).reached).toBe(false);
    expect((await loadMessagesUntilAction(T, MSG, 'garbage')).reached).toBe(false);
    expect(getMessagesPage).not.toHaveBeenCalled();
  });
});
