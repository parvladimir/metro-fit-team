import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/data/profile', () => ({ requireAuthUser: async () => ({ id: 'user-1' }) }));
vi.mock('server-only', () => ({}));
const rpc = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { pinMessageAction, unpinMessageAction } from './pin-actions';

const MSG = '11111111-1111-4111-8111-111111111111';
beforeEach(() => rpc.mockReset());

describe('pinMessageAction', () => {
  it('asks the database to pin, without replacing unless confirmed', async () => {
    rpc.mockResolvedValue({ data: [{ out_changed: true, out_replaced: false }], error: null });
    expect(await pinMessageAction({ messageId: MSG })).toEqual({ ok: true, changed: true, replaced: false });
    expect(rpc).toHaveBeenCalledWith('pin_team_message', { p_message_id: MSG, p_replace: false });
    await pinMessageAction({ messageId: MSG, replace: true });
    expect(rpc).toHaveBeenLastCalledWith('pin_team_message', { p_message_id: MSG, p_replace: true });
  });

  it('tells "replaced" and "nothing changed" apart', async () => {
    rpc.mockResolvedValue({ data: [{ out_changed: true, out_replaced: true }], error: null });
    expect(await pinMessageAction({ messageId: MSG, replace: true })).toEqual({ ok: true, changed: true, replaced: true });
    rpc.mockResolvedValue({ data: [{ out_changed: false, out_replaced: false }], error: null });
    expect(await pinMessageAction({ messageId: MSG })).toEqual({ ok: true, changed: false, replaced: false });
  });

  it('another pin exists → the caller is asked to confirm', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'pin_exists', code: 'P0001' } });
    expect(await pinMessageAction({ messageId: MSG })).toMatchObject({ ok: false, code: 'pin_exists' });
  });

  it('"not allowed", "no such message" and "not pinnable" all read the same — nothing about other teams leaks', async () => {
    const answers = [];
    for (const message of ['message_not_found', 'message_not_pinnable']) {
      rpc.mockResolvedValue({ data: null, error: { message, code: 'P0001' } });
      answers.push(await pinMessageAction({ messageId: MSG }));
    }
    expect(answers[0]).toEqual(answers[1]);
    expect(answers[0]).toEqual({ ok: false, code: 'refused', error: 'Diese Nachricht kann nicht angeheftet werden.' });
  });

  it('a database without the function yet is "unavailable"; other failures are generic', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'x', code: 'PGRST202' } });
    expect(await pinMessageAction({ messageId: MSG })).toMatchObject({ ok: false, code: 'unavailable' });
    rpc.mockResolvedValue({ data: null, error: { message: 'internal secret', code: 'XX000' } });
    const res = await pinMessageAction({ messageId: MSG });
    expect(res).toMatchObject({ ok: false, code: 'error' });
    expect(JSON.stringify(res)).not.toContain('secret');
  });

  it('refuses a malformed id without calling the database', async () => {
    expect(await pinMessageAction({ messageId: 'nope' })).toMatchObject({ ok: false, code: 'refused' });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('unpinMessageAction', () => {
  it('unpins and reports whether anything changed', async () => {
    rpc.mockResolvedValue({ data: [{ out_changed: true }], error: null });
    expect(await unpinMessageAction({ messageId: MSG })).toEqual({ ok: true, changed: true });
    expect(rpc).toHaveBeenCalledWith('unpin_team_message', { p_message_id: MSG });
    rpc.mockResolvedValue({ data: [{ out_changed: false }], error: null });
    expect(await unpinMessageAction({ messageId: MSG })).toEqual({ ok: true, changed: false });
  });

  it('a refusal and a missing function get clear messages; a malformed id never reaches the database', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'message_not_found', code: 'P0001' } });
    expect(await unpinMessageAction({ messageId: MSG })).toEqual({ ok: false, error: 'Die Anheftung konnte nicht aufgehoben werden.' });
    rpc.mockResolvedValue({ data: null, error: { message: 'x', code: '42883' } });
    expect(await unpinMessageAction({ messageId: MSG })).toEqual({ ok: false, error: 'Diese Funktion ist noch nicht verfügbar.' });
    rpc.mockClear();
    expect(await unpinMessageAction({ messageId: 'nope' })).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
});
