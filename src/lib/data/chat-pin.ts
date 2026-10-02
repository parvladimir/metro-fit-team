import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { PIN_SELECT, pinFromRow, type PinnedMessage } from '@/lib/chat-pin';
import { isMissingObject } from '@/lib/data/exercise-library';

export type PinLoad =
  | { status: 'ok'; pin: PinnedMessage | null }
  /** The database has not been migrated yet: the strip and the "Anheften" action stay hidden. */
  | { status: 'unavailable' }
  | { status: 'error' };

/** The team's pinned message, if any. */
export async function getTeamPin(teamId: string): Promise<PinLoad> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from('team_chat_pins').select(PIN_SELECT).eq('team_id', teamId).maybeSingle();
    if (error) return isMissingObject(error) ? { status: 'unavailable' } : { status: 'error' };
    return { status: 'ok', pin: pinFromRow(data) };
  } catch {
    return { status: 'error' };
  }
}
