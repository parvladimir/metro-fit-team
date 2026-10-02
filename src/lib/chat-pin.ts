import { resolveAuthorName } from '@/lib/chat-identity';
import { quoteFromMessage, type QuoteInfo } from '@/lib/chat-quote';

/** What the pinned-message strip shows. Built from the ORIGINAL message row on every load (never a stored
 * copy), so an edit shows up and a deleted message simply stops being a pin. */
export type PinnedMessage = QuoteInfo;

/** The select shared by the server loader and the browser's realtime refetch. The embedded message is read
 * under the same RLS as the chat list itself. */
export const PIN_SELECT = 'message_id, messages(id, content, message_type, deleted_at, parent_message_id, profiles(full_name))';

interface PinRow {
  message_id: string | null;
  messages: {
    id: string;
    content: string;
    message_type: string;
    deleted_at: string | null;
    parent_message_id: string | null;
    profiles: { full_name: string | null } | null;
  } | null;
}

/** A pin row (as selected with PIN_SELECT) → what to show, or null when nothing is pinned or the pinned
 * message is gone / not visible. */
export function pinFromRow(row: unknown): PinnedMessage | null {
  const r = row as PinRow | null;
  const m = r?.messages;
  if (!r || !r.message_id || !m || m.deleted_at || m.message_type === 'system' || m.parent_message_id) return null;
  return quoteFromMessage({ id: m.id, authorName: resolveAuthorName(m.profiles), content: m.content, message_type: m.message_type, deleted_at: m.deleted_at });
}
