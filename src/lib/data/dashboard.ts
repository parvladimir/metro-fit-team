import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { startOfWeek } from '@/lib/date';
import type { Profile, Workout, WorkoutPlanDay, Challenge, ChallengeParticipant } from '@/types/database';

export interface DashboardData {
  weekly: {
    completedWorkouts: number;
    weeklyGoal: number;
    minutes: number;
    points: number;
    pointsDeltaPct: number | null;
    workoutsDeltaPct: number | null;
  };
  rank: number | null;
  todayPlanDay: (WorkoutPlanDay & { exerciseCount: number }) | null;
  todayWorkout: Workout | null;
  activeChallenge: (Challenge & { myProgress: number; participantCount: number }) | null;
  weeklyChart: { label: string; minutes: number }[];
}

export async function getDashboardData(profile: Profile, teamId: string | null): Promise<DashboardData> {
  const supabase = await createClient();
  const weekStart = startOfWeek();
  const weekStartIso = weekStart.toISOString();
  const weekEndIso = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: completedThisWeek }, { data: comparison }] = await Promise.all([
    supabase
      .from('workouts')
      .select('id, duration_seconds, finished_at')
      .eq('user_id', profile.id)
      .eq('status', 'abgeschlossen')
      .gte('finished_at', weekStartIso)
      .lt('finished_at', weekEndIso),
    supabase.rpc('get_weekly_comparison', { p_user_id: profile.id }),
  ]);

  const completedWorkouts = completedThisWeek?.length ?? 0;
  const minutes = Math.round((completedThisWeek ?? []).reduce((sum, w) => sum + (w.duration_seconds ?? 0), 0) / 60);

  type ComparisonRow = { metric: string; current_value: number; previous_value: number };
  const rows = (comparison ?? []) as ComparisonRow[];
  const pointsRow = rows.find((r) => r.metric === 'points');
  const workoutsRow = rows.find((r) => r.metric === 'workouts');
  const points = pointsRow ? Math.round(pointsRow.current_value) : 0;

  const pctChange = (current: number, previous: number): number | null => {
    if (previous === 0) return current > 0 ? 100 : null;
    return Math.round(((current - previous) / previous) * 100);
  };

  let rank: number | null = null;
  if (teamId) {
    const { data: ranking } = await supabase.rpc('get_team_ranking', { p_team_id: teamId, p_period: 'current_week' });
    const sorted = (ranking ?? []) as { user_id: string; points: number }[];
    const idx = sorted.findIndex((r) => r.user_id === profile.id);
    rank = idx >= 0 ? idx + 1 : null;
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const todayWeekday = ((new Date().getDay() + 6) % 7) + 1; // 1 Montag .. 7 Sonntag

  const { data: activePlan } = await supabase
    .from('workout_plans')
    .select('id')
    .eq('user_id', profile.id)
    .eq('is_active', true)
    .maybeSingle();

  let todayPlanDay: DashboardData['todayPlanDay'] = null;
  if (activePlan) {
    const { data: day } = await supabase
      .from('workout_plan_days')
      .select('*, workout_plan_exercises(count)')
      .eq('plan_id', activePlan.id)
      .eq('weekday', todayWeekday)
      .maybeSingle();

    if (day) {
      const exerciseCount = Array.isArray(day.workout_plan_exercises)
        ? (day.workout_plan_exercises[0]?.count ?? 0)
        : 0;
      todayPlanDay = { ...(day as WorkoutPlanDay), exerciseCount };
    }
  }

  const { data: todayWorkout } = await supabase
    .from('workouts')
    .select('*')
    .eq('user_id', profile.id)
    .eq('scheduled_date', todayIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let activeChallenge: DashboardData['activeChallenge'] = null;
  if (teamId) {
    const { data: challenge } = await supabase
      .from('challenges')
      .select('*')
      .eq('team_id', teamId)
      .lte('starts_at', todayIso)
      .gte('ends_at', todayIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (challenge) {
      const { data: participants } = await supabase
        .from('challenge_participants')
        .select('user_id, progress_value')
        .eq('challenge_id', challenge.id);

      const rows = (participants ?? []) as Pick<ChallengeParticipant, 'user_id' | 'progress_value'>[];
      const mine = rows.find((p) => p.user_id === profile.id);
      const isTeamChallenge = challenge.challenge_type === 'team';
      const myProgress = isTeamChallenge
        ? rows.reduce((sum, p) => sum + Number(p.progress_value), 0)
        : Number(mine?.progress_value ?? 0);

      activeChallenge = { ...(challenge as Challenge), myProgress, participantCount: rows.length };
    }
  }

  const weeklyChart = buildWeeklyChart(completedThisWeek ?? [], weekStart);

  return {
    weekly: {
      completedWorkouts,
      weeklyGoal: profile.weekly_goal,
      minutes,
      points,
      pointsDeltaPct: pointsRow ? pctChange(pointsRow.current_value, pointsRow.previous_value) : null,
      workoutsDeltaPct: workoutsRow ? pctChange(workoutsRow.current_value, workoutsRow.previous_value) : null,
    },
    rank,
    todayPlanDay,
    todayWorkout: (todayWorkout as Workout) ?? null,
    activeChallenge,
    weeklyChart,
  };
}

function buildWeeklyChart(workouts: { duration_seconds: number | null; finished_at: string | null }[], weekStart: Date) {
  const labels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const minutesByDay = new Array(7).fill(0);

  for (const w of workouts) {
    if (!w.finished_at) continue;
    const dayIdx = Math.floor((new Date(w.finished_at).getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000));
    if (dayIdx >= 0 && dayIdx < 7) {
      minutesByDay[dayIdx] += Math.round((w.duration_seconds ?? 0) / 60);
    }
  }

  return labels.map((label, i) => ({ label, minutes: minutesByDay[i] }));
}
