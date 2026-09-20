import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveMentions, isUuid, type MessageMention } from '@/lib/mentions';

/** Parses the mention ids a client sends (JSON array of uuids), dropping junk. */
export function parseMentionIds(raw: unknown): string[] {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && isUuid(x)).slice(0, 20) : [];
  } catch {
    return [];
  }
}

/**
 * Makes message_mentions match the message text: keeps only real members of the
 * message's team whose current "@Name" appears in `content`. Returns the final
 * mentions and which user ids are NEW (only those may ever be notified — the
 * DB additionally refuses to notify for already-edited messages).
 * Runs with the caller's own client, so RLS + the DB triggers are the final
 * authority: another team's user or a forged id simply fails to insert.
 */
export async function syncMentions(
  supabase: SupabaseClient,
  params: { messageId: string; teamId: string; content: string; requestedIds: string[]; authorId: string; addAllowed?: boolean }
): Promise<{ mentions: MessageMention[]; added: string[] }> {
  const { data: members } = await supabase
    .from('team_members')
    .select('user_id, profiles(full_name)')
    .eq('team_id', params.teamId);
  const team = (members ?? []).map((m) => ({
    id: (m as { user_id: string }).user_id,
    name: (m as unknown as { profiles: { full_name: string | null } | null }).profiles?.full_name ?? null,
  }));

  const wanted = resolveMentions(params.content, params.requestedIds, team, params.authorId);
  const { data: existingRows } = await supabase.from('message_mentions').select('mentioned_user_id').eq('message_id', params.messageId);
  const existing = new Set((existingRows ?? []).map((r) => r.mentioned_user_id as string));

  const wantedIds = new Set(wanted.map((w) => w.userId));
  const toRemove = [...existing].filter((id) => !wantedIds.has(id));
  if (toRemove.length) await supabase.from('message_mentions').delete().eq('message_id', params.messageId).in('mentioned_user_id', toRemove);

  const added: string[] = [];
  if (params.addAllowed !== false) {
    for (const w of wanted) {
      if (existing.has(w.userId)) continue;
      const { error } = await supabase.from('message_mentions').insert({ message_id: params.messageId, mentioned_user_id: w.userId });
      if (!error) added.push(w.userId);
    }
  }
  const finalIds = new Set([...existing].filter((id) => wantedIds.has(id)).concat(added));
  return { mentions: wanted.filter((w) => finalIds.has(w.userId)), added };
}
