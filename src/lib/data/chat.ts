import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { resolveAuthorName } from '@/lib/chat-identity';
import type { Message, Profile } from '@/types/database';

export interface ChatMessage extends Message {
  authorName: string;
  authorAvatar: string | null;
}

export async function getRecentMessages(teamId: string, limit = 50): Promise<ChatMessage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('messages')
    .select('*, profiles(full_name, avatar_url)')
    .eq('team_id', teamId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(limit);

  return (data ?? []).map((row) => {
    const r = row as unknown as Message & { profiles: Pick<Profile, 'full_name' | 'avatar_url'> | null };
    return {
      ...r,
      authorName: resolveAuthorName(r.profiles),
      authorAvatar: r.profiles?.avatar_url ?? null,
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
