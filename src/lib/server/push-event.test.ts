import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const sendNotification = vi.fn(async () => ({}));
vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...(a as [])) } }));
vi.mock('@/lib/env', () => ({ publicEnv: { vapidPublicKey: 'pub' }, getServerEnv: () => ({ vapidPrivateKey: 'priv' }) }));

type Row = Record<string, unknown>;
let tables: Record<string, Row[] | Row | null>;
const admin = {
  from: (name: string) => {
    const chain: Record<string, unknown> = {};
    const result = () => ({ data: tables[name] ?? null, count: Array.isArray(tables[name]) ? (tables[name] as Row[]).length : 0 });
    for (const m of ['select', 'eq', 'is', 'in', 'neq']) chain[m] = () => chain;
    chain.single = () => Promise.resolve({ data: Array.isArray(tables[name]) ? (tables[name] as Row[])[0] : tables[name] });
    chain.maybeSingle = chain.single;
    chain.delete = () => chain;
    chain.then = (res: (v: unknown) => unknown) => res(result());
    return chain;
  },
};
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin }));

import { notifyEventOwner } from './push';

const base = { ownerId: 'owner', actorId: 'actor', messageId: '1d28b13b-575c-488e-bc71-11f447c4915e', kind: 'reaction' as const, eventTitle: 'Beine' };

describe('notifyEventOwner', () => {
  beforeEach(() => {
    sendNotification.mockClear();
    tables = {
      profiles: { full_name: 'Tim Aigner' },
      notification_preferences: { reaktionen_antworten: true },
      push_subscriptions: [{ id: 's1', endpoint: 'https://push.example/1', p256dh: 'k', auth: 'a' }],
      notifications: [{ id: 'n1' }],
    };
  });

  it('B. pushes to the owner with deep link, tag and badge count', async () => {
    await notifyEventOwner(base);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const payload = JSON.parse((sendNotification.mock.calls[0] as unknown[])[1] as string);
    expect(payload.title).toBe('METRO Fit Team');
    expect(payload.body).toBe('Tim unterstützt dein Training „Beine“ 💪');
    expect(payload.url).toBe('/team/chat?message=1d28b13b-575c-488e-bc71-11f447c4915e');
    expect(payload.badgeCount).toBe(1);
  });

  it('D. reply push includes a short preview', async () => {
    await notifyEventOwner({ ...base, kind: 'reply', replyContent: 'Stark!' });
    const payload = JSON.parse((sendNotification.mock.calls[0] as unknown[])[1] as string);
    expect(payload.body).toBe('Tim hat auf dein Training geantwortet: „Stark!“');
  });

  it('E. never notifies yourself', async () => {
    await notifyEventOwner({ ...base, actorId: 'owner' });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('respects the "Reaktionen & Antworten" preference', async () => {
    tables.notification_preferences = { reaktionen_antworten: false };
    await notifyEventOwner(base);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('H. no subscription (permission denied) → silently nothing, no throw', async () => {
    tables.push_subscriptions = [];
    await expect(notifyEventOwner(base)).resolves.toBeUndefined();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('a failing push provider never throws', async () => {
    sendNotification.mockRejectedValueOnce({ statusCode: 500 });
    await expect(notifyEventOwner(base)).resolves.toBeUndefined();
  });
});
