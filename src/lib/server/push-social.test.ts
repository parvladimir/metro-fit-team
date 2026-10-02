import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const sendNotification = vi.fn(async (..._args: unknown[]) => ({}));
vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...a) } }));
const env = vi.hoisted(() => ({ vapidPublicKey: 'pub' as string | undefined }));
vi.mock('@/lib/env', () => ({ publicEnv: env, getServerEnv: () => ({ vapidPrivateKey: 'priv' }) }));

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
const deleted: { table: string }[] = [];

/** A tiny in-memory stand-in for the Supabase query builder: real filtering
 * for eq / neq / in / is, so tests can prove WHO a push goes to. */
function query(name: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let removing = false;
  const rows = () => (tables[name] ?? []).filter((r) => filters.every((f) => f(r)));
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = (col: string, v: unknown) => (filters.push((r) => r[col] === v), chain);
  chain.neq = (col: string, v: unknown) => (filters.push((r) => r[col] !== v), chain);
  chain.in = (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), chain);
  chain.is = (col: string, v: unknown) => (filters.push((r) => (r[col] ?? null) === v), chain);
  chain.delete = () => ((removing = true), chain);
  const one = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
  chain.maybeSingle = one;
  chain.single = one;
  chain.then = (resolve: (v: unknown) => unknown) => {
    if (removing) deleted.push({ table: name });
    return resolve({ data: rows(), error: null, count: rows().length });
  };
  return chain;
}
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (name: string) => query(name) }) }));

import { notifyDuelAccepted, notifyDuelInvitation, notifyTrainingChanged, notifyTrainingInvitation } from './push';

const NOW = new Date('2026-10-02T10:00:00Z'); // 12:00 Berlin
const sub = (user_id: string, n = 1) => ({ id: `s-${user_id}-${n}`, user_id, endpoint: `https://push.example/${user_id}/${n}`, p256dh: 'k', auth: 'a' });
const pref = (user_id: string, over: Row = {}): Row => ({
  user_id, duelle: true, gemeinsame_trainings: true, quiet_hours_start: null, quiet_hours_end: null, motivation_paused_until: null, ...over,
});
const endpoints = () => (sendNotification.mock.calls as unknown as [{ endpoint: string }][]).map((c) => c[0].endpoint);
const lastPayload = () => JSON.parse((sendNotification.mock.calls.at(-1) as unknown[])[1] as string) as Record<string, unknown>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  sendNotification.mockClear();
  deleted.length = 0;
  env.vapidPublicKey = 'pub';
  tables = {
    profiles: [
      { id: 'ann', full_name: 'Ann Beispiel' },
      { id: 'ben', full_name: 'Ben Muster' },
    ],
    team_members: [
      { team_id: 't', user_id: 'ann' },
      { team_id: 't', user_id: 'ben' },
    ],
    team_duels: [
      { id: 'd1', team_id: 't', inviter_id: 'ann', invitee_id: 'ben', status: 'pending', expires_at: '2026-10-04T22:00:00Z', target_days: 4, starts_on: '2026-10-05' },
    ],
    notification_preferences: [pref('ann'), pref('ben')],
    push_subscriptions: [sub('ann'), sub('ben')],
  };
});
afterEach(() => vi.useRealTimers());

describe('notifyDuelInvitation', () => {
  it('sends ONE push to the invitee only, with the inviter\'s first name and a link to the duel page', async () => {
    await notifyDuelInvitation({ duelId: 'd1' });
    expect(endpoints()).toEqual(['https://push.example/ben/1']);
    expect(lastPayload()).toEqual({
      title: 'METRO Fit Team',
      body: 'Ann lädt dich zu einem Freundschaftsduell ein.',
      url: '/team/duelle',
      tag: 'duel-d1',
    });
  });

  it('never leaks the goal, the dates or any other duel detail into the notification', async () => {
    await notifyDuelInvitation({ duelId: 'd1' });
    const raw = (sendNotification.mock.calls[0] as unknown[])[1] as string;
    expect(raw).not.toMatch(/Trainingstag|Ziel|2026|05\.10|Beispiel/);
  });

  it('is opt-in: nothing goes out unless the invitee explicitly switched "Duelle" on', async () => {
    for (const row of [pref('ben', { duelle: false }), pref('ben', { duelle: null }), { user_id: 'ben', quiet_hours_start: null, quiet_hours_end: null, motivation_paused_until: null }]) {
      tables.notification_preferences = [pref('ann'), row];
      await notifyDuelInvitation({ duelId: 'd1' });
    }
    tables.notification_preferences = [pref('ann')]; // no preference row at all
    await notifyDuelInvitation({ duelId: 'd1' });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('the other opt-in does not stand in for it', async () => {
    tables.notification_preferences = [pref('ann'), pref('ben', { duelle: false, gemeinsame_trainings: true })];
    await notifyDuelInvitation({ duelId: 'd1' });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('respects quiet hours, but a motivation pause does not silence an invitation', async () => {
    tables.notification_preferences = [pref('ann'), pref('ben', { quiet_hours_start: '08:00:00', quiet_hours_end: '18:00:00' })]; // 12:00 Berlin is inside
    await notifyDuelInvitation({ duelId: 'd1' });
    expect(sendNotification).not.toHaveBeenCalled();

    tables.notification_preferences = [pref('ann'), pref('ben', { motivation_paused_until: '2026-10-20T00:00:00Z' })];
    await notifyDuelInvitation({ duelId: 'd1' });
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it('sends nothing for a duel that is no longer a live pending invitation', async () => {
    for (const patch of [{ status: 'declined' }, { status: 'cancelled' }, { status: 'accepted' }, { status: 'expired' }, { expires_at: '2026-10-02T09:59:00Z' }]) {
      tables.team_duels = [{ ...tables.team_duels![0]!, ...patch }];
      await notifyDuelInvitation({ duelId: 'd1' });
    }
    tables.team_duels = [];
    await notifyDuelInvitation({ duelId: 'd1' }); // no such duel
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('sends nothing when either person has left the team since', async () => {
    tables.team_members = [{ team_id: 't', user_id: 'ann' }];
    await notifyDuelInvitation({ duelId: 'd1' });
    tables.team_members = [{ team_id: 't', user_id: 'ben' }];
    await notifyDuelInvitation({ duelId: 'd1' });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('reaches every device of the invitee, and does nothing without a subscription or without push configured', async () => {
    tables.push_subscriptions = [sub('ben', 1), sub('ben', 2), sub('ann')];
    await notifyDuelInvitation({ duelId: 'd1' });
    expect(endpoints().sort()).toEqual(['https://push.example/ben/1', 'https://push.example/ben/2']);

    sendNotification.mockClear();
    tables.push_subscriptions = [sub('ann')];
    await notifyDuelInvitation({ duelId: 'd1' });
    expect(sendNotification).not.toHaveBeenCalled();

    tables.push_subscriptions = [sub('ben')];
    env.vapidPublicKey = undefined;
    await notifyDuelInvitation({ duelId: 'd1' });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('a failing push provider never throws, and a dead subscription is cleaned up', async () => {
    sendNotification.mockRejectedValueOnce({ statusCode: 500 });
    await expect(notifyDuelInvitation({ duelId: 'd1' })).resolves.toBeUndefined();
    expect(deleted).toEqual([]);

    sendNotification.mockRejectedValueOnce({ statusCode: 410 });
    await expect(notifyDuelInvitation({ duelId: 'd1' })).resolves.toBeUndefined();
    expect(deleted).toEqual([{ table: 'push_subscriptions' }]);
  });
});

describe('notifyDuelAccepted', () => {
  beforeEach(() => {
    tables.team_duels = [{ ...tables.team_duels![0]!, status: 'accepted' }];
  });

  it('tells the inviter — and only the inviter — that the duel was accepted', async () => {
    await notifyDuelAccepted({ duelId: 'd1' });
    expect(endpoints()).toEqual(['https://push.example/ann/1']);
    expect(lastPayload()).toMatchObject({ body: 'Ben hat dein Duell angenommen.', url: '/team/duelle', tag: 'duel-d1' });
  });

  it('is opt-in for the inviter too, and honours quiet hours', async () => {
    tables.notification_preferences = [pref('ann', { duelle: false }), pref('ben')];
    await notifyDuelAccepted({ duelId: 'd1' });
    tables.notification_preferences = [pref('ann', { quiet_hours_start: '08:00:00', quiet_hours_end: '18:00:00' }), pref('ben')];
    await notifyDuelAccepted({ duelId: 'd1' });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('sends nothing unless the duel is actually accepted — declining or withdrawing never notifies', async () => {
    for (const status of ['pending', 'declined', 'cancelled', 'expired']) {
      tables.team_duels = [{ ...tables.team_duels![0]!, status }];
      await notifyDuelAccepted({ duelId: 'd1' });
    }
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe('training invitation pushes', () => {
  const MSG = '1d28b13b-575c-488e-bc71-11f447c4915e';
  beforeEach(() => {
    tables.profiles = [
      { id: 'org', full_name: 'Olga Organisiert' },
      { id: 'ann', full_name: 'Ann Beispiel' },
      { id: 'ben', full_name: 'Ben Muster' },
      { id: 'cleo', full_name: 'Cleo Test' },
    ];
    tables.team_members = ['org', 'ann', 'ben', 'cleo'].map((user_id) => ({ team_id: 't', user_id }));
    tables.training_invites = [
      { id: 'inv1', message_id: MSG, team_id: 't', organizer_id: 'org', title: 'Beine & Rücken', place: 'Eingang Studio', note: 'Handtuch', starts_at: '2026-10-03T16:30:00Z', cancelled_at: null },
    ];
    tables.messages = [{ id: MSG, deleted_at: null }];
    tables.training_invite_rsvps = [
      { invite_id: 'inv1', user_id: 'org', status: 'going' },
      { invite_id: 'inv1', user_id: 'ann', status: 'going' },
      { invite_id: 'inv1', user_id: 'ben', status: 'maybe' },
    ];
    // org + ann + ben opted in to joint trainings; cleo did not (default).
    tables.notification_preferences = [
      pref('org'),
      pref('ann'),
      pref('ben'),
      pref('cleo', { gemeinsame_trainings: false }),
    ];
    tables.push_subscriptions = ['org', 'ann', 'ben', 'cleo'].map((u) => sub(u));
  });

  describe('notifyTrainingInvitation', () => {
    it('pushes once to every opted-in team mate except the organizer — and to nobody else', async () => {
      await notifyTrainingInvitation({ inviteId: 'inv1' });
      expect(endpoints().sort()).toEqual(['https://push.example/ann/1', 'https://push.example/ben/1']);
      expect(lastPayload()).toEqual({
        title: 'METRO Fit Team',
        body: 'Olga lädt zu einem gemeinsamen Training ein.',
        url: `/team/chat?message=${MSG}`,
        tag: 'training-inv1',
      });
    });

    it('never puts the title, time, place or note into the notification', async () => {
      await notifyTrainingInvitation({ inviteId: 'inv1' });
      const raw = (sendNotification.mock.calls[0] as unknown[])[1] as string;
      expect(raw).not.toMatch(/Beine|Rücken|Eingang|Studio|Handtuch|18:30|16:30|2026|Organisiert/);
    });

    it('is opt-in: nobody is pushed without an explicit true, and a missing preference row counts as "no"', async () => {
      tables.notification_preferences = [pref('org'), pref('ann', { gemeinsame_trainings: false }), pref('ben', { gemeinsame_trainings: null })];
      await notifyTrainingInvitation({ inviteId: 'inv1' }); // cleo has no row at all
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it('the duel opt-in does not stand in for it', async () => {
      tables.notification_preferences = [pref('org'), pref('ann', { gemeinsame_trainings: false, duelle: true }), pref('ben', { gemeinsame_trainings: false, duelle: true }), pref('cleo', { gemeinsame_trainings: false, duelle: true })];
      await notifyTrainingInvitation({ inviteId: 'inv1' });
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it('respects quiet hours per recipient, and a motivation pause does not silence an invitation', async () => {
      tables.notification_preferences = [
        pref('org'),
        pref('ann', { quiet_hours_start: '08:00:00', quiet_hours_end: '18:00:00' }), // 12:00 Berlin is inside
        pref('ben', { motivation_paused_until: '2026-10-20T00:00:00Z' }),
        pref('cleo', { gemeinsame_trainings: false }),
      ];
      await notifyTrainingInvitation({ inviteId: 'inv1' });
      expect(endpoints()).toEqual(['https://push.example/ben/1']);
    });

    it('sends nothing for a cancelled invitation, one that has started, or one whose message was deleted', async () => {
      for (const patch of [{ cancelled_at: '2026-10-02T09:00:00Z' }, { starts_at: '2026-10-02T09:00:00Z' }]) {
        tables.training_invites = [{ ...tables.training_invites![0]!, ...patch }];
        await notifyTrainingInvitation({ inviteId: 'inv1' });
      }
      tables.training_invites = [{ ...tables.training_invites![0]!, cancelled_at: null, starts_at: '2026-10-03T16:30:00Z' }];
      tables.messages = [{ id: MSG, deleted_at: '2026-10-02T09:00:00Z' }];
      await notifyTrainingInvitation({ inviteId: 'inv1' });
      tables.messages = [];
      await notifyTrainingInvitation({ inviteId: 'inv1' });
      tables.training_invites = [];
      await notifyTrainingInvitation({ inviteId: 'inv1' });
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it('does not push to someone who has left the team', async () => {
      tables.team_members = ['org', 'ben'].map((user_id) => ({ team_id: 't', user_id }));
      await notifyTrainingInvitation({ inviteId: 'inv1' });
      expect(endpoints()).toEqual(['https://push.example/ben/1']);
    });

    it('does nothing when push is not configured, and a failing provider never throws', async () => {
      env.vapidPublicKey = undefined;
      await notifyTrainingInvitation({ inviteId: 'inv1' });
      expect(sendNotification).not.toHaveBeenCalled();
      env.vapidPublicKey = 'pub';
      sendNotification.mockRejectedValue({ statusCode: 500 });
      await expect(notifyTrainingInvitation({ inviteId: 'inv1' })).resolves.toBeUndefined();
      sendNotification.mockReset();
      sendNotification.mockImplementation(async () => ({}));
    });
  });

  describe('notifyTrainingChanged', () => {
    it('a reschedule goes once to the opted-in people who answered — not to the actor, and not to people who never answered', async () => {
      await notifyTrainingChanged({ inviteId: 'inv1', kind: 'rescheduled', actorId: 'org' });
      expect(endpoints().sort()).toEqual(['https://push.example/ann/1', 'https://push.example/ben/1']);
      expect(lastPayload()).toEqual({
        title: 'METRO Fit Team',
        body: 'Olga hat Zeit oder Ort eines gemeinsamen Trainings geändert.',
        url: `/team/chat?message=${MSG}`,
        tag: 'training-inv1', // same tag as the invitation: it replaces that notification on the device
      });
    });

    it('a cancellation says so, and only once the invitation really is cancelled', async () => {
      await notifyTrainingChanged({ inviteId: 'inv1', kind: 'cancelled', actorId: 'org' });
      expect(sendNotification).not.toHaveBeenCalled(); // not cancelled in the database yet

      tables.training_invites = [{ ...tables.training_invites![0]!, cancelled_at: '2026-10-02T10:00:00Z' }];
      await notifyTrainingChanged({ inviteId: 'inv1', kind: 'cancelled', actorId: 'org' });
      expect(endpoints().sort()).toEqual(['https://push.example/ann/1', 'https://push.example/ben/1']);
      expect(lastPayload().body).toBe('Olga hat ein gemeinsames Training abgesagt.');
    });

    it('never leaks the title, time, place or note', async () => {
      await notifyTrainingChanged({ inviteId: 'inv1', kind: 'rescheduled', actorId: 'org' });
      const raw = (sendNotification.mock.calls[0] as unknown[])[1] as string;
      expect(raw).not.toMatch(/Beine|Rücken|Eingang|Studio|Handtuch|18:30|16:30|2026/);
    });

    it('a reschedule is not sent for a cancelled or already-started training', async () => {
      tables.training_invites = [{ ...tables.training_invites![0]!, cancelled_at: '2026-10-02T10:00:00Z' }];
      await notifyTrainingChanged({ inviteId: 'inv1', kind: 'rescheduled', actorId: 'org' });
      tables.training_invites = [{ ...tables.training_invites![0]!, cancelled_at: null, starts_at: '2026-10-02T09:00:00Z' }];
      await notifyTrainingChanged({ inviteId: 'inv1', kind: 'rescheduled', actorId: 'org' });
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it('is opt-in and honours quiet hours', async () => {
      tables.notification_preferences = [pref('org'), pref('ann', { gemeinsame_trainings: false }), pref('ben', { quiet_hours_start: '08:00:00', quiet_hours_end: '18:00:00' })];
      await notifyTrainingChanged({ inviteId: 'inv1', kind: 'rescheduled', actorId: 'org' });
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it('the actor is excluded even when they are a participant (e.g. a co-organizer)', async () => {
      // The actor is excluded even when they are a participant (e.g. a co-organizer scenario).
      await notifyTrainingChanged({ inviteId: 'inv1', kind: 'rescheduled', actorId: 'ann' });
      expect(endpoints().sort()).toEqual(['https://push.example/ben/1', 'https://push.example/org/1']);
    });

    it('does not push to a participant who has left the team', async () => {
      tables.team_members = ['org', 'ann'].map((user_id) => ({ team_id: 't', user_id }));
      await notifyTrainingChanged({ inviteId: 'inv1', kind: 'rescheduled', actorId: 'org' });
      expect(endpoints()).toEqual(['https://push.example/ann/1']);
    });
  });
});
