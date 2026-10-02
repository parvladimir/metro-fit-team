import 'server-only';
import { createClient } from '@/lib/supabase/server';

/** One Berlin week of aggregate team numbers — counts only, by design: no
 * names, ids or per-person values exist in this shape or in the database
 * function behind it. */
export interface EngagementWeek {
  weekStart: string;
  inProgress: boolean;
  memberCount: number;
  countedMembers: number;
  activeParticipants: number;
  returningParticipants: number;
  supportedWorkouts: number;
  goalReachedMembers: number;
  missionsStarted: number;
  missionsReached: number;
  missionsCancelled: number;
  duelsAccepted: number;
  duelsFinished: number;
  trainingInvitesCreated: number;
}

interface Row {
  week_start: string;
  in_progress: boolean;
  member_count: number;
  counted_members: number;
  active_participants: number;
  returning_participants: number;
  supported_workouts: number;
  goal_reached_members: number;
  missions_started: number;
  missions_reached: number;
  missions_cancelled: number;
  duels_accepted: number;
  duels_finished: number;
  training_invites_created: number;
}

/** The weekly summary for a team admin (the database function refuses anyone
 * else). Returns null — not an error — when it cannot be read, e.g. because
 * the function does not exist yet, so the page can say so plainly. */
export async function getTeamEngagementSummary(teamId: string, weeks = 8): Promise<EngagementWeek[] | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('get_team_engagement_summary', { p_team_id: teamId, p_weeks: weeks });
    if (error || !data) return null;
    return (data as Row[]).map((r) => ({
      weekStart: r.week_start,
      inProgress: r.in_progress,
      memberCount: r.member_count,
      countedMembers: r.counted_members,
      activeParticipants: r.active_participants,
      returningParticipants: r.returning_participants,
      supportedWorkouts: r.supported_workouts,
      goalReachedMembers: r.goal_reached_members,
      missionsStarted: r.missions_started,
      missionsReached: r.missions_reached,
      missionsCancelled: r.missions_cancelled,
      duelsAccepted: r.duels_accepted,
      duelsFinished: r.duels_finished,
      trainingInvitesCreated: r.training_invites_created,
    }));
  } catch {
    return null;
  }
}
