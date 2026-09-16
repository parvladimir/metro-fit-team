import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Achievement, UserAchievement } from '@/types/database';

export interface AchievementWithUnlock extends Achievement {
  unlockedAt: string | null;
}

export async function getUserAchievements(userId: string): Promise<AchievementWithUnlock[]> {
  const supabase = await createClient();
  const [{ data: all }, { data: unlocked }] = await Promise.all([
    supabase.from('achievements').select('*'),
    supabase.from('user_achievements').select('*').eq('user_id', userId),
  ]);

  const unlockedMap = new Map(((unlocked ?? []) as UserAchievement[]).map((u) => [u.achievement_id, u.unlocked_at]));

  return ((all ?? []) as Achievement[]).map((a) => ({ ...a, unlockedAt: unlockedMap.get(a.id) ?? null }));
}
