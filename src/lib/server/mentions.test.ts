import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { parseMentionIds, syncMentions } from './mentions';

const ID = '1d28b13b-575c-488e-bc71-11f447c4915e';

describe('parseMentionIds', () => {
  it('accepts JSON array of uuids only', () => {
    expect(parseMentionIds(JSON.stringify([ID, 'x', 5, '../../etc']))).toEqual([ID]);
    expect(parseMentionIds('not json')).toEqual([]);
    expect(parseMentionIds(null)).toEqual([]);
    expect(parseMentionIds([ID])).toEqual([ID]);
  });
});

function fakeSupabase(state: { members: { user_id: string; profiles: { full_name: string | null } }[]; existing: string[]; failInsertFor?: string[] }) {
  const inserted: string[] = [];
  const deleted: string[][] = [];
  const client = {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      let mode: 'select' | 'insert' | 'delete' = 'select';
      let payload: Record<string, unknown> | null = null;
      c.select = () => c;
      c.eq = () => c;
      c.in = (_col: string, ids: string[]) => {
        if (mode === 'delete') deleted.push(ids);
        return c;
      };
      c.insert = (row: Record<string, unknown>) => {
        mode = 'insert';
        payload = row;
        const id = row.mentioned_user_id as string;
        const fail = state.failInsertFor?.includes(id);
        if (!fail) inserted.push(id);
        return Promise.resolve({ error: fail ? { message: 'mentioned_user_not_in_team' } : null });
      };
      c.delete = () => {
        mode = 'delete';
        return c;
      };
      c.then = (res: (v: unknown) => unknown) => {
        if (table === 'team_members') return res({ data: state.members });
        if (table === 'message_mentions' && mode === 'select') return res({ data: state.existing.map((id) => ({ mentioned_user_id: id })) });
        return res({ data: null, error: null });
      };
      void payload;
      return c;
    },
  };
  return { client: client as never, inserted, deleted };
}

const base = { messageId: 'm1', teamId: 'team', authorId: 'me' };
const members = [
  { user_id: 't', profiles: { full_name: 'Thorsten Roloff' } },
  { user_id: 'd', profiles: { full_name: 'Dennis Meier' } },
  { user_id: 'me', profiles: { full_name: 'Ich' } },
];

describe('syncMentions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('E. new message: inserts the mention for a real member and reports it as added', async () => {
    const f = fakeSupabase({ members, existing: [] });
    const r = await syncMentions(f.client, { ...base, content: '@Thorsten Roloff testest du das?', requestedIds: ['t'] });
    expect(f.inserted).toEqual(['t']);
    expect(r.added).toEqual(['t']);
    expect(r.mentions).toEqual([{ userId: 't', text: '@Thorsten Roloff' }]);
  });

  it('G. an id that is not in this team is never inserted', async () => {
    const f = fakeSupabase({ members, existing: [] });
    const r = await syncMentions(f.client, { ...base, content: '@Fremd Person hi', requestedIds: ['outsider-id'] });
    expect(f.inserted).toEqual([]);
    expect(r.mentions).toEqual([]);
  });

  it('a DB rejection (RLS/trigger) is swallowed and not reported as added', async () => {
    const f = fakeSupabase({ members, existing: [], failInsertFor: ['t'] });
    const r = await syncMentions(f.client, { ...base, content: '@Thorsten Roloff hi', requestedIds: ['t'] });
    expect(r.added).toEqual([]);
    expect(r.mentions).toEqual([]);
  });

  it('K. edit: existing mention kept (not re-added), removed one deleted, new one added', async () => {
    const f = fakeSupabase({ members, existing: ['t'] });
    const r = await syncMentions(f.client, { ...base, content: '@Dennis Meier statt Thorsten', requestedIds: ['d'] });
    expect(f.deleted).toEqual([['t']]);
    expect(f.inserted).toEqual(['d']);
    expect(r.added).toEqual(['d']);
    expect(r.mentions.map((m) => m.userId)).toEqual(['d']);
  });

  it('J. edit that keeps the mention re-adds nothing (so nothing can be re-notified)', async () => {
    const f = fakeSupabase({ members, existing: ['t'] });
    const r = await syncMentions(f.client, { ...base, content: 'Neuer Text @Thorsten Roloff', requestedIds: ['t'] });
    expect(f.inserted).toEqual([]);
    expect(r.added).toEqual([]);
    expect(r.mentions.map((m) => m.userId)).toEqual(['t']);
  });

  it('editing the mention text away removes the relation', async () => {
    const f = fakeSupabase({ members, existing: ['t'] });
    const r = await syncMentions(f.client, { ...base, content: 'kein Name mehr', requestedIds: ['t'] });
    expect(f.deleted).toEqual([['t']]);
    expect(r.mentions).toEqual([]);
  });

  it('a mention of yourself is ignored', async () => {
    const f = fakeSupabase({ members, existing: [] });
    await syncMentions(f.client, { ...base, content: '@Ich', requestedIds: ['me'] });
    expect(f.inserted).toEqual([]);
  });
});
