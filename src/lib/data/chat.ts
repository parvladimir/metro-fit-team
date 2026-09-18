import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { resolveAuthorName } from '@/lib/chat-identity';
import { fetchCreators } from '@/lib/creator';
import type { EventReply, EventSocial } from '@/lib/event-social';
import type { Message, Profile } from '@/types/database';

export interface ChatMessage extends Message {
  authorName: string;
  authorAvatar: string | null;
  /** Verified creator display name (from platform_creators), else null. */
  creatorName: string | null;
}

export async function getRecentMessages(teamId: string, limit = 50): Promise<ChatMessage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('messages')
    .select('*, profiles(full_name, avatar_url)')
    .eq('team_id', teamId)
    .is('deleted_at', null)
    .is('parent_message_id', null)
    .order('created_at', { ascending: true })
    .limit(limit);

  const creators = await fetchCreators(supabase, (data ?? []).map((r) => (r as { user_id: string }).user_id));

  return (data ?? []).map((row) => {
    const r = row as unknown as Message & { profiles: Pick<Profile, 'full_name' | 'avatar_url'> | null };
    return {
      ...r,
      authorName: resolveAuthorName(r.profiles),
      authorAvatar: r.profiles?.avatar_url ?? null,
      creatorName: creators.get(r.user_id)?.displayName ?? null,
    };
  });
}

export async function getUnreadChatCount(teamId: string): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_unread_chat_count', { p_team_id: teamId });
  if (error) return 0;
  return Number(data ?? 0);
}

/** The caller's own last-read timestamp for this team's chat, before this
 * page view marks anything new as read (used to render the "Neue
 * Nachrichten" divider at the right spot). Null if never read before. */
export async function getChatLastReadAt(teamId: string, userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('team_message_read_state')
    .select('last_read_at')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .maybeSingle();

  return data?.last_read_at ?? null;
}

/** Reactions + replies for a batch of events in two queries (no N+1). */
export async function getEventSocial(eventIds: string[]): Promise<Record<string, EventSocial>> {
  const out: Record<string, EventSocial> = {};
  if (eventIds.length === 0) return out;
  for (const id of eventIds) out[id] = { reactors: [], replies: [] };

  const supabase = await createClient();
  const [reactions, replies] = await Promise.all([
    supabase.from('message_reactions').select('message_id, user_id').in('message_id', eventIds),
    supabase
      .from('messages')
      .select('id, user_id, content, created_at, parent_message_id, profiles(full_name, avatar_url)')
      .in('parent_message_id', eventIds)
      .is('deleted_at', null)
      .order('created_at', { ascending: true }),
  ]);

  for (const r of reactions.data ?? []) out[r.message_id]?.reactors.push(r.user_id);
  for (const row of replies.data ?? []) {
    const r = row as unknown as { id: string; user_id: string; content: string; created_at: string; parent_message_id: string; profiles: Pick<Profile, 'full_name' | 'avatar_url'> | null };
    const reply: EventReply = {
      id: r.id,
      user_id: r.user_id,
      content: r.content,
      created_at: r.created_at,
      authorName: resolveAuthorName(r.profiles),
      authorAvatar: r.profiles?.avatar_url ?? null,
    };
    out[r.parent_message_id]?.replies.push(reply);
  }
  return out;
}

/** Personal (reaction/reply) notifications — deliberately separate from the
 * team-chat unread count. */
export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('category', 'reaktion_antwort')
    .is('read_at', null);
  return count ?? 0;
}

export interface PersonalNotification {
  id: string;
  kind: 'reaction' | 'reply' | null;
  message_id: string | null;
  params: { actor_name?: string; event_title?: string | null; preview?: string };
  read_at: string | null;
  created_at: string;
}

export async function getRecentNotifications(userId: string, limit = 5): Promise<PersonalNotification[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('notifications')
    .select('id, kind, message_id, params, read_at, created_at')
    .eq('user_id', userId)
    .eq('category', 'reaktion_antwort')
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as PersonalNotification[];
}
