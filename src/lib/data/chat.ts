import 'server-only';
import { createClient } from '@/lib/supabase/server';
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
    return { ...r, authorName: r.profiles?.full_name || 'Mitglied', authorAvatar: r.profiles?.avatar_url ?? null };
  });
}
