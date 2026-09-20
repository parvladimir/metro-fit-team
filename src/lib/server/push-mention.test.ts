import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const sendNotification = vi.fn(async () => ({}));
vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...(a as [])) } }));
vi.mock('@/lib/env', () => ({ publicEnv: { vapidPublicKey: 'pub' }, getServerEnv: () => ({ vapidPrivateKey: 'priv' }) }));

type Row = Record<string, unknown>;
let tables: Record<string, Row[] | Row | null>;
const admin = {
  from: (name: string) => {
    let filterIn: { col: string; ids: string[] } | null = null;
    let neqUser: string | null = null;
    const rows = () => {
      let t = tables[name];
      if (!Array.isArray(t)) return t;
      if (filterIn) t = t.filter((r) => filterIn!.ids.includes(r[filterIn!.col] as string));
      if (neqUser) t = t.filter((r) => r.user_id !== neqUser);
      return t;
    };
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is']) chain[m] = () => chain;
    chain.in = (col: string, ids: string[]) => {
      filterIn = { col, ids };
      return chain;
    };
    chain.neq = (_c: string, v: string) => {
      neqUser = v;
      return chain;
    };
    chain.single = () => Promise.resolve({ data: Array.isArray(rows()) ? (rows() as Row[])[0] : rows() });
    chain.maybeSingle = chain.single;
    chain.delete = () => chain;
    chain.then = (res: (v: unknown) => unknown) => res({ data: rows(), count: Array.isArray(rows()) ? (rows() as Row[]).length : 0 });
    return chain;
  },
};
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin }));

import { notifyMentionedUsers, notifyTeamOfNewChatMessage } from './push';

const MSG = '1d28b13b-575c-488e-bc71-11f447c4915e';
const sub = (user_id: string) => ({ id: `s-${user_id}`, user_id, endpoint: `https://push.example/${user_id}`, p256dh: 'k', auth: 'a' });

describe('mention push', () => {
  beforeEach(() => {
    sendNotification.mockClear();
    tables = {
      profiles: { full_name: 'Volodymyr Parashchak' },
      notification_preferences: [
        { user_id: 'thorsten', erwaehnungen: true, chat_nachrichten: true },
        { user_id: 'dennis', erwaehnungen: false, chat_nachrichten: true },
      ],
      push_subscriptions: [sub('thorsten'), sub('dennis'), sub('tim')],
      notifications: [{ id: 'n1' }],
      teams: { name: 'METRO' },
      team_members: [{ user_id: 'thorsten' }, { user_id: 'dennis' }, { user_id: 'tim' }, { user_id: 'volodymyr' }],
    };
  });

  it('E/F. sends ONE push with title, preview and deep link to the message', async () => {
    const handled = await notifyMentionedUsers({ authorId: 'volodymyr', messageId: MSG, targetMessageId: MSG, userIds: ['thorsten'], content: '@Thorsten Roloff kannst du das **bitte** testen?' });
    expect(handled).toEqual(['thorsten']);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const p = JSON.parse((sendNotification.mock.calls[0] as unknown[])[1] as string);
    expect(p.title).toBe('Volodymyr hat dich im Team-Chat erwähnt');
    expect(p.body).toBe('@Thorsten Roloff kannst du das bitte testen?');
    expect(p.url).toBe(`/team/chat?message=${MSG}`);
  });

  it('respects the "Erwähnungen" preference: no mention push, and the user is NOT excluded from the chat push', async () => {
    const handled = await notifyMentionedUsers({ authorId: 'volodymyr', messageId: MSG, targetMessageId: MSG, userIds: ['dennis'], content: '@Dennis hi' });
    expect(handled).toEqual([]);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('never notifies the author', async () => {
    const handled = await notifyMentionedUsers({ authorId: 'thorsten', messageId: MSG, targetMessageId: MSG, userIds: ['thorsten'], content: '@Thorsten Roloff' });
    expect(handled).toEqual([]);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('a reply mention deep-links to the event', async () => {
    await notifyMentionedUsers({ authorId: 'volodymyr', messageId: 'reply-id', targetMessageId: MSG, userIds: ['thorsten'], content: '@Thorsten stark' });
    const p = JSON.parse((sendNotification.mock.calls[0] as unknown[])[1] as string);
    expect(p.url).toBe(`/team/chat?message=${MSG}`);
  });

  it('7. no double push: the mentioned user is excluded from the normal chat fan-out', async () => {
    const handled = await notifyMentionedUsers({ authorId: 'volodymyr', messageId: MSG, targetMessageId: MSG, userIds: ['thorsten'], content: '@Thorsten Roloff hi' });
    sendNotification.mockClear();
    await notifyTeamOfNewChatMessage({ teamId: 't', senderId: 'volodymyr', content: '@Thorsten Roloff hi', excludeUserIds: handled });
    const endpoints = (sendNotification.mock.calls as unknown as [{ endpoint: string }][]).map((c) => c[0].endpoint);
    expect(endpoints).not.toContain('https://push.example/thorsten');
  });

  it('a failing push provider never throws', async () => {
    sendNotification.mockRejectedValueOnce({ statusCode: 500 });
    await expect(notifyMentionedUsers({ authorId: 'volodymyr', messageId: MSG, targetMessageId: MSG, userIds: ['thorsten'], content: 'x' })).resolves.toEqual(['thorsten']);
  });
});
