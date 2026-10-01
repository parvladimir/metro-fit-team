import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { berlinDayRange, berlinWeekRange } from '@/lib/date';
import type { ActivityType } from '@/types/database';

export type TeamActivityPeriod = 'today' | 'yesterday' | 'week';

export interface TeamActivityWorkout {
  workoutId: string;
  messageId: string;
  activityType: ActivityType;
  title: string | null;
  finishedAt: string;
  durationSeconds: number | null;
  durationSource: 'timer' | 'corrected';
}

export interface TeamActivityMember {
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  /** Newest first. One member with several workouts today is still one
   * entry here — the UI decides how to collapse/expand it. */
  workouts: TeamActivityWorkout[];
}

export interface TeamActivitySummary {
  activeMemberCount: number;
  /** Sorted by each member's own most recent workout — not points or
   * duration, per the "Heute im Team" spec. */
  members: TeamActivityMember[];
  /** Only meaningful for `period: 'today'`; 0 for 'yesterday'/'week'. */
  runningCount: number;
}

export const EMPTY_TEAM_ACTIVITY: TeamActivitySummary = { activeMemberCount: 0, members: [], runningCount: 0 };

function rangeFor(period: TeamActivityPeriod, now: Date): { start: Date; end: Date } {
  if (period === 'yesterday') return berlinDayRange(-1, now);
  if (period === 'week') return berlinWeekRange(now);
  return berlinDayRange(0, now);
}

type ActivityRow = {
  workout_id: string;
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  activity_type: ActivityType;
  title: string | null;
  finished_at: string;
  duration_seconds: number | null;
  duration_source: 'timer' | 'corrected';
  message_id: string;
};

/**
 * Which teammates completed a workout in `period`, grouped per member, for
 * the "Heute im Team" Home card and its fuller `/team/aktivitaet` view.
 * Privacy and started/completed/pending-confirmation/deleted exclusion are
 * all enforced inside `get_team_workout_activity` itself (see
 * 0041_team_workout_activity.sql) — this function only shapes the result.
 */
export async function getTeamActivity(teamId: string, period: TeamActivityPeriod = 'today', now: Date = new Date()): Promise<TeamActivitySummary> {
  const { start, end } = rangeFor(period, now);
  const supabase = await createClient();

  const [{ data: rows }, { data: runningRaw }] = await Promise.all([
    supabase.rpc('get_team_workout_activity', { p_team_id: teamId, p_range_start: start.toISOString(), p_range_end: end.toISOString() }),
    period === 'today' ? supabase.rpc('get_team_running_count', { p_team_id: teamId }) : Promise.resolve({ data: 0 }),
  ]);

  const byUser = new Map<string, TeamActivityMember>();
  // Rows arrive newest-finished-first; grouping in that order means each
  // member's own `workouts` list, and the first workout seen per member, are
  // already newest-first with no extra sort needed.
  for (const r of (rows ?? []) as ActivityRow[]) {
    const workout: TeamActivityWorkout = {
      workoutId: r.workout_id,
      messageId: r.message_id,
      activityType: r.activity_type,
      title: r.title,
      finishedAt: r.finished_at,
      durationSeconds: r.duration_seconds,
      durationSource: r.duration_source,
    };
    const existing = byUser.get(r.user_id);
    if (existing) existing.workouts.push(workout);
    else byUser.set(r.user_id, { userId: r.user_id, fullName: r.full_name || '—', avatarUrl: r.avatar_url, workouts: [workout] });
  }

  const members = [...byUser.values()].sort(
    (a, b) => new Date(b.workouts[0]!.finishedAt).getTime() - new Date(a.workouts[0]!.finishedAt).getTime()
  );

  return { activeMemberCount: members.length, members, runningCount: Number(runningRaw ?? 0) };
}
