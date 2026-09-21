import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// ---- a tiny in-memory PostgREST-like builder over an array of message rows ----
type Row = { id: string; team_id: string; user_id: string; content: string; created_at: string; deleted_at: string | null; parent_message_id: string | null; message_type: string };
let table: Row[] = [];
let insertError: { code: string; message: string } | null = null;
let mentionsThrow = false;
const notifyTeam = vi.fn(async () => undefined);
const notifyMentioned = vi.fn(async () => [] as string[]);

function builder(rows: Row[]) {
  let list = [...rows];
  let desc = false;
  let lim: number | null = null;
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.eq = (col: keyof Row, v: unknown) => ((list = list.filter((r) => r[col] === v)), c);
  c.is = (col: keyof Row, v: unknown) => ((list = list.filter((r) => r[col] === v)), c);
  c.lt = (col: keyof Row, v: string) => ((list = list.filter((r) => (r[col] as string) < v)), c);
  c.order = (col: keyof Row, o: { ascending: boolean }) => {
    desc = !o.ascending;
    list.sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (desc ? -1 : 1));
    return c;
  };
  c.limit = (n: number) => ((lim = n), c);
  c.then = (res: (v: unknown) => unknown) => res({ data: (lim ? list.slice(0, lim) : list).map((r) => ({ ...r, profiles: { full_name: 'Tim A', avatar_url: null } })) });
  return c;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (name: string) => {
      if (name === 'messages') {
        const b = builder(table);
        (b as Record<string, unknown>).insert = (row: Partial<Row>) => {
          const created: Row = { id: 'new-id', team_id: '', user_id: '', content: '', created_at: '2030-01-01T00:00:00Z', deleted_at: null, parent_message_id: null, message_type: 'text', ...row };
          const single = () => Promise.resolve(insertError ? { data: null, error: insertError } : { data: { ...created, profiles: { full_name: 'Tim A', avatar_url: null } }, error: null });
          const chain: Record<string, unknown> = { select: () => ({ single }) };
          return chain;
        };
        return b;
      }
      return { select: () => ({ in: () => Promise.resolve({ data: [] }) }) };
    },
  }),
}));
vi.mock('@/lib/creator', () => ({ fetchCreators: async () => new Map() }));
vi.mock('@/lib/data/profile', () => ({ requireAuthUser: async () => ({ id: 'u1' }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => void p }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/server/push', () => ({ notifyTeamOfNewChatMessage: (...a: unknown[]) => notifyTeam(...(a as [])), notifyMentionedUsers: (...a: unknown[]) => notifyMentioned(...(a as [])), notifyEventOwner: vi.fn() }));
vi.mock('@/lib/server/mentions', () => ({
  parseMentionIds: (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : []),
  syncMentions: async () => {
    if (mentionsThrow) throw new Error('mention relation failed');
    return { mentions: [{ userId: 't', text: '@Tim A' }], added: ['t'] };
  },
}));

import { getMessagesPage } from '@/lib/data/chat';
import { sendMessageAction } from '@/app/(app)/team/chat/actions';

const TEAM = '1d28b13b-575c-488e-bc71-11f447c4915e';
const mk = (i: number): Row => ({
  id: `m${String(i).padStart(3, '0')}`,
  team_id: TEAM,
  user_id: 'u',
  content: `msg ${i}`,
  created_at: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(),
  deleted_at: null,
  parent_message_id: null,
  message_type: i % 3 === 0 ? 'system' : 'text',
});

describe('reload query returns the NEWEST messages (root cause of the vanishing-message bug)', () => {
  beforeEach(() => {
    table = Array.from({ length: 150 }, (_, i) => mk(i + 1));
  });

  it('a message sent after 149 older ones is still on the first page after reload', async () => {
    const { messages, hasMore } = await getMessagesPage(TEAM, { limit: 60 });
    expect(messages).toHaveLength(60);
    expect(messages.at(-1)!.id).toBe('m150'); // the newest message is present
    expect(hasMore).toBe(true);
    expect(messages[0]!.id).toBe('m091');
  });

  it('is oldest → newest for display', async () => {
    const { messages } = await getMessagesPage(TEAM, { limit: 60 });
    const ids = messages.map((m) => m.id);
    expect([...ids].sort()).toEqual(ids);
  });

  it('paging backwards yields the previous window without overlap or gaps', async () => {
    const first = await getMessagesPage(TEAM, { limit: 60 });
    const older = await getMessagesPage(TEAM, { limit: 60, before: first.messages[0]!.created_at });
    expect(older.messages.at(-1)!.id).toBe('m090');
    expect(older.messages[0]!.id).toBe('m031');
    expect(older.hasMore).toBe(true);
    const last = await getMessagesPage(TEAM, { limit: 60, before: older.messages[0]!.created_at });
    expect(last.messages).toHaveLength(30);
    expect(last.hasMore).toBe(false);
  });

  it('a short history (< page size) has no "load older"', async () => {
    table = table.slice(0, 10);
    const r = await getMessagesPage(TEAM, { limit: 60 });
    expect(r.messages).toHaveLength(10);
    expect(r.hasMore).toBe(false);
  });

  it('deleted messages and thread replies stay excluded, without hiding valid ones', async () => {
    table[149]!.deleted_at = '2026-09-02T00:00:00Z';
    table[148]!.parent_message_id = 'x';
    const { messages } = await getMessagesPage(TEAM, { limit: 60 });
    expect(messages.at(-1)!.id).toBe('m148');
  });
});

describe('sendMessageAction: success is reported only for a persisted message', () => {
  const fd = (content: string, mentions: string[] = []) => {
    const f = new FormData();
    f.set('teamId', TEAM);
    f.set('content', content);
    f.set('mentions', JSON.stringify(mentions));
    return f;
  };
  beforeEach(() => {
    vi.clearAllMocks();
    insertError = null;
    mentionsThrow = false;
    table = [];
  });

  it('returns the stored row (id = source of truth) for a plain message', async () => {
    const r = await sendMessageAction(fd('Hallo'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.message.id).toBe('new-id');
      expect(r.message.authorName).toBe('Tim A');
      expect(r.mentions).toEqual([]);
    }
  });

  it('a failed INSERT is an error, never a fake "sent", and nothing is notified', async () => {
    insertError = { code: '42501', message: 'new row violates row-level security policy' };
    const r = await sendMessageAction(fd('Hallo'));
    expect(r).toEqual({ ok: false, error: 'Nachricht konnte nicht gesendet werden.' });
    expect(notifyTeam).not.toHaveBeenCalled();
  });

  it('a mention relation failure does NOT unsend the message', async () => {
    mentionsThrow = true;
    const r = await sendMessageAction(fd('@Tim A Test', ['1d28b13b-575c-488e-bc71-11f447c4915e']));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.message.content).toBe('@Tim A Test');
  });

  it('a message with a mention returns its mention metadata', async () => {
    const r = await sendMessageAction(fd('@Tim A Test', ['1d28b13b-575c-488e-bc71-11f447c4915e']));
    expect(r.ok && r.mentions).toEqual([{ userId: 't', text: '@Tim A' }]);
  });

  it('empty content is rejected without touching the database', async () => {
    expect((await sendMessageAction(fd('   '))).ok).toBe(false);
  });
});
