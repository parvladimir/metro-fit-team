import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { startOfWeek } from '@/lib/date';

export interface ProfileStats {
  totalWorkouts: number;
  streakWeeks: number;
}

export async function getProfileStats(userId: string): Promise<ProfileStats> {
  const supabase = await createClient();

  const { count: totalWorkouts } = await supabase
    .from('workouts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'abgeschlossen');

  const { data: recentWorkouts } = await supabase
    .from('workouts')
    .select('finished_at')
    .eq('user_id', userId)
    .eq('status', 'abgeschlossen')
    .gte('finished_at', new Date(Date.now() - 52 * 7 * 24 * 60 * 60 * 1000).toISOString());

  const weeksWithWorkout = new Set(
    (recentWorkouts ?? [])
      .filter((w) => w.finished_at)
      .map((w) => startOfWeek(new Date(w.finished_at as string)).toISOString())
  );

  let streakWeeks = 0;
  const cursor = startOfWeek();
  while (weeksWithWorkout.has(cursor.toISOString())) {
    streakWeeks += 1;
    cursor.setDate(cursor.getDate() - 7);
  }

  return { totalWorkouts: totalWorkouts ?? 0, streakWeeks };
}
