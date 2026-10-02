'use server';

import { createClient } from '@/lib/supabase/server';
import { requireAuthUser } from '@/lib/data/profile';
import { isMissingObject } from '@/lib/data/exercise-library';

/**
 * Pin / unpin ONE message of the team chat. Who may do it is decided in the database (pin_team_message /
 * unpin_team_message): only a real team_admin of the message's team — never a badge shown in the UI.
 * "Not allowed" and "no such message" get the same answer, so a message id of another team cannot be probed.
 * Pinning writes no message, no notification and no read state: it cannot change an unread count or push.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFUSED = 'Diese Nachricht kann nicht angeheftet werden.';

export type PinResult =
  | { ok: true; changed: boolean; replaced: boolean }
  /** `pin_exists`: another message is pinned — ask before replacing it. */
  | { ok: false; code: 'pin_exists' | 'refused' | 'unavailable' | 'error'; error: string };

export async function pinMessageAction(input: { messageId: string; replace?: boolean }): Promise<PinResult> {
  const { messageId } = input;
  if (!UUID_RE.test(String(messageId))) return { ok: false, code: 'refused', error: REFUSED };
  await requireAuthUser();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('pin_team_message', { p_message_id: messageId, p_replace: input.replace === true });
  if (error) {
    if (isMissingObject(error)) return { ok: false, code: 'unavailable', error: 'Diese Funktion ist noch nicht verfügbar.' };
    const m = error.message ?? '';
    if (m.includes('pin_exists')) return { ok: false, code: 'pin_exists', error: 'Es ist bereits eine Nachricht angeheftet.' };
    if (m.includes('message_not_found') || m.includes('message_not_pinnable')) return { ok: false, code: 'refused', error: REFUSED };
    return { ok: false, code: 'error', error: 'Nachricht konnte nicht angeheftet werden.' };
  }
  const row = (data as Array<{ out_changed: boolean; out_replaced: boolean }> | null)?.[0];
  return { ok: true, changed: row?.out_changed === true, replaced: row?.out_replaced === true };
}

export type UnpinResult = { ok: true; changed: boolean } | { ok: false; error: string };

export async function unpinMessageAction(input: { messageId: string }): Promise<UnpinResult> {
  const { messageId } = input;
  if (!UUID_RE.test(String(messageId))) return { ok: false, error: 'Ungültige Anfrage.' };
  await requireAuthUser();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('unpin_team_message', { p_message_id: messageId });
  if (error) {
    if (isMissingObject(error)) return { ok: false, error: 'Diese Funktion ist noch nicht verfügbar.' };
    return { ok: false, error: 'Die Anheftung konnte nicht aufgehoben werden.' };
  }
  return { ok: true, changed: (data as Array<{ out_changed: boolean }> | null)?.[0]?.out_changed === true };
}
