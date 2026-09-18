import type { SupabaseClient } from '@supabase/supabase-js';

/** Creator identity comes from the platform_creators table, keyed by the stable
 * auth user id — never from a display name. It is presentational only. */
export interface CreatorInfo {
  displayName: string;
}

export async function fetchCreators(supabase: SupabaseClient, userIds: string[]): Promise<Map<string, CreatorInfo>> {
  const ids = [...new Set(userIds)];
  const map = new Map<string, CreatorInfo>();
  if (ids.length === 0) return map;
  const { data } = await supabase.from('platform_creators').select('user_id, display_name').in('user_id', ids);
  for (const row of data ?? []) map.set(row.user_id as string, { displayName: row.display_name as string });
  return map;
}

/** Only real human messages get the creator card — never automatic events. */
export function isCreatorCardMessage(message: { message_type: string }, creator: CreatorInfo | null | undefined): boolean {
  return !!creator && (message.message_type === 'text' || message.message_type === 'image');
}

export type TextPart = { type: 'text'; value: string } | { type: 'link'; value: string; href: string };

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;

/** Splits text into plain and http(s) link parts. Anything that is not an
 * http(s) URL stays plain text (no javascript: links, no HTML injection —
 * React escapes the text). Trailing punctuation is left outside the link. */
export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    let url = match[0];
    const trail = url.match(/[.,;:!?)\]]+$/)?.[0] ?? '';
    if (trail) url = url.slice(0, -trail.length);
    if (start > last) parts.push({ type: 'text', value: text.slice(last, start) });
    parts.push({ type: 'link', value: url, href: url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts;
}
