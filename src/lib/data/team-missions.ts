import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { localDayKey } from '@/lib/date';
import type { TeamMission } from '@/types/database';

export interface TeamMissionWithProgress extends TeamMission {
  trainingDays: number;
  isCompleted: boolean;
  /** True while the "Gemeinsam geschafft!" treatment should show — based on
   * how recent `celebrated_at` is, not on whether THIS request happened to
   * be the one that claimed it. A team celebration that only the one member
   * whose request won the atomic claim ever sees would defeat its own
   * purpose, so display is decoupled from the one-time write below. */
  justCelebrated: boolean;
}

const CELEBRATION_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/** The team's current (non-cancelled, in its date range) mission, with live
 * progress. Progress is always computed fresh from `workouts` — a departed
 * or newly opted-out member's past contribution simply stops counting on
 * the next call, with no separate recompute step. */
export async function getCurrentTeamMission(teamId: string, now: Date = new Date()): Promise<TeamMissionWithProgress | null> {
  const supabase = await createClient();
  // The Berlin calendar day, not the UTC one: mission start/end dates are team
  // calendar dates, and between 00:00 and 02:00 Berlin time the UTC date is
  // still "yesterday", which showed a mission a day late / a day too long.
  const today = localDayKey(now);

  const { data: mission } = await supabase
    .from('team_missions')
    .select('*')
    .eq('team_id', teamId)
    .is('cancelled_at', null)
    .lte('starts_at', today)
    .gte('ends_at', today)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!mission) return null;
  const m = mission as TeamMission;

  const { data: trainingDaysRaw } = await supabase.rpc('get_team_mission_training_days', {
    p_team_id: teamId,
    p_start_date: m.starts_at,
    p_end_date: m.ends_at,
  });
  const trainingDays = Number(trainingDaysRaw ?? 0);

  // Opportunistically claim the once-only celebration the first time anyone
  // views the mission after it reaches target — whoever's request gets here
  // first triggers the write, but (per the comment above) that has no
  // bearing on who gets to SEE the celebration.
  let celebratedAt = m.celebrated_at;
  if (trainingDays >= m.target_days && !celebratedAt) {
    const { data: claimed } = await supabase.rpc('maybe_celebrate_mission', { p_mission_id: m.id });
    if (claimed) celebratedAt = now.toISOString();
  }

  const justCelebrated = !!celebratedAt && now.getTime() - new Date(celebratedAt).getTime() < CELEBRATION_WINDOW_MS;

  return { ...m, celebrated_at: celebratedAt, trainingDays, isCompleted: trainingDays >= m.target_days, justCelebrated };
}
