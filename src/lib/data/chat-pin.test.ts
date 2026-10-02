import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

let result: { data: unknown; error: { code?: string } | null };
let clientFails = false;
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (clientFails) throw new Error('client blew up');
    return {
      from: () => {
        const q: Record<string, unknown> = {};
        q.select = () => q;
        q.eq = () => q;
        q.maybeSingle = async () => result;
        return q;
      },
    };
  },
}));

import { getTeamPin } from './chat-pin';

beforeEach(() => {
  clientFails = false;
  result = { data: null, error: null };
});

describe('getTeamPin', () => {
  it('no pin is a normal answer', async () => {
    expect(await getTeamPin('t-1')).toEqual({ status: 'ok', pin: null });
    result = { data: { message_id: null, messages: null }, error: null }; // an emptied pin row
    expect(await getTeamPin('t-1')).toEqual({ status: 'ok', pin: null });
  });

  it('a pinned message becomes the strip data', async () => {
    result = { data: { message_id: 'm-1', messages: { id: 'm-1', content: 'Hallo', message_type: 'text', deleted_at: null, parent_message_id: null, profiles: { full_name: 'Tim' } } }, error: null };
    expect(await getTeamPin('t-1')).toEqual({ status: 'ok', pin: { id: 'm-1', authorName: 'Tim', preview: 'Hallo', isImage: false, deleted: false } });
  });

  it('a deleted pinned message is no pin', async () => {
    result = { data: { message_id: 'm-1', messages: { id: 'm-1', content: 'x', message_type: 'text', deleted_at: '2026-10-01T00:00:00Z', parent_message_id: null, profiles: null } }, error: null };
    expect(await getTeamPin('t-1')).toEqual({ status: 'ok', pin: null });
  });

  it('a database without the table yet is "unavailable"; any other failure is an error', async () => {
    result = { data: null, error: { code: 'PGRST205' } };
    expect(await getTeamPin('t-1')).toEqual({ status: 'unavailable' });
    result = { data: null, error: { code: '42501' } };
    expect(await getTeamPin('t-1')).toEqual({ status: 'error' });
    clientFails = true;
    expect(await getTeamPin('t-1')).toEqual({ status: 'error' });
  });
});
