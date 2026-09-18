import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { t, type TranslationKey } from '@/lib/i18n';
import type { ActivityFeedItem, Profile } from '@/types/database';

export interface FeedItemWithActor extends ActivityFeedItem {
  actorName: string | null;
}

export async function getTeamActivityFeed(teamId: string, limit = 30): Promise<FeedItemWithActor[]> {
  const supabase = await createClient();
  // `profiles!inner` (rather than the default left-join embed) drops any
  // feed row whose actor no longer resolves to a profile, so a deleted
  // account never surfaces as an anonymous "Jemand"-attributed entry.
  const { data } = await supabase
    .from('activity_feed')
    .select('*, profiles!inner(full_name)')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => {
    const r = row as unknown as ActivityFeedItem & { profiles: Pick<Profile, 'full_name'> | null };
    return { ...r, actorName: r.profiles?.full_name ?? null };
  });
}

export function renderFeedItem(item: FeedItemWithActor): string {
  const params: Record<string, string | number> = {
    name: item.actorName || 'Jemand',
    ...(item.params as Record<string, string | number>),
  };
  return t(item.message_key as TranslationKey, params);
}
