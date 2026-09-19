import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const notifyTeam = vi.fn();
const notifyOwner = vi.fn();
vi.mock('@/lib/server/push', () => ({ notifyTeamOfNewChatMessage: (...a: unknown[]) => notifyTeam(...a), notifyEventOwner: (...a: unknown[]) => notifyOwner(...a) }));
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/data/profile', () => ({ requireAuthUser: async () => ({ id: 'me' }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));

let current: { message_type: string; content: string } | null;
let updated: Record<string, unknown> | null;
const updateSpy = vi.fn();
const chain = (result: () => unknown) => {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'neq']) c[m] = () => c;
  c.maybeSingle = () => Promise.resolve(result());
  c.update = (patch: unknown) => {
    updateSpy(patch);
    return c;
  };
  return c;
};
let mode: 'read' | 'update' = 'read';
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => {
      const c = chain(() => (mode === 'read' ? { data: current } : { data: updated, error: updated ? null : { message: 'x' } }));
      const origUpdate = c.update as (p: unknown) => unknown;
      c.update = (p: unknown) => {
        mode = 'update';
        return origUpdate(p);
      };
      return c;
    },
  }),
}));

import { editMessageAction } from '@/app/(app)/team/chat/actions';

const ID = '1d28b13b-575c-488e-bc71-11f447c4915e';

describe('editMessageAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mode = 'read';
    current = { message_type: 'text', content: 'alt' };
    updated = { content: 'neu', edited_at: '2026-01-01T00:00:00Z' };
  });

  it('edits in place with Markdown preserved and CRLF normalised, and sends NO push', async () => {
    updated = { content: '* a\n* **b**', edited_at: '2026-01-01T00:00:00Z' };
    const res = await editMessageAction(ID, '* a\r\n* **b**');
    expect(res).toMatchObject({ ok: true, content: '* a\n* **b**' });
    expect(updateSpy).toHaveBeenCalledWith({ content: '* a\n* **b**' });
    expect(notifyTeam).not.toHaveBeenCalled();
    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it('refuses system events and foreign/missing messages', async () => {
    current = { message_type: 'system', content: 'x' };
    expect((await editMessageAction(ID, 'neu')).ok).toBe(false);
    current = null;
    expect((await editMessageAction(ID, 'neu')).ok).toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('rejects empty text and malformed ids', async () => {
    expect((await editMessageAction(ID, '   ')).ok).toBe(false);
    expect((await editMessageAction('../x', 'neu')).ok).toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('unchanged content is a no-op (no update, no edited flag)', async () => {
    const res = await editMessageAction(ID, 'alt');
    expect(res.ok).toBe(true);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
