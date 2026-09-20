import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { startOfWeek } from '@/lib/date';
import { computeStreakDays, detectPersonalRecord, type CoachInput, type CoachTeamEvent, type RecordSet } from '@/lib/coach';
import { normalizeExerciseType } from '@/lib/exercise-types';
import type { DashboardData } from '@/lib/data/dashboard';
import type { ExerciseType, Profile } from '@/types/database';

const DAY_MS = 24 * 60 * 60 * 1000;
/** how long the after-workout celebration stays on the Startseite */
export const CELEBRATION_WINDOW_MS = 30 * 60 * 1000;

type ServerPart = Omit<CoachInput, 'firstName' | 'weekly'>;

const METRIC_UNITS: Record<string, string | null> = {
  workouts_count: 'Trainings',
  strength_sessions: 'Krafttrainings',
  minutes: 'Min.',
  distance_km: 'km',
  steps: 'Schritte',
  custom: null,
};

const firstNameOf = (full: string | null | undefined) => (full ?? '').trim().split(/\s+/)[0] ?? '';
const berlinDate = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });

/**
 * Everything the coach header needs beyond the dashboard data. All queries run
 * in parallel with the caller's RLS-scoped client, so the header can only ever
 * see what the user may see: own workouts, and team activity that members
 * opted in to share (the feed/system events are only written for opted-in users).
 * No weights, measurements or notes of anyone else are read.
 */
export async function getCoachData(profile: Profile, teamId: string | null, dash: DashboardData): Promise<ServerPart> {
  const supabase = await createClient();
  const now = new Date();
  const sinceDay = new Date(now.getTime() - DAY_MS).toISOString();
  const weekStart = startOfWeek().toISOString();

  const [active, totalRes, recent, feed, goalEvents] = await Promise.all([
    supabase.from('workouts').select('id').eq('user_id', profile.id).eq('status', 'laeuft').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('workouts').select('id', { count: 'exact', head: true }).eq('user_id', profile.id).eq('status', 'abgeschlossen'),
    supabase
      .from('workouts')
      .select('id, title, duration_seconds, finished_at')
      .eq('user_id', profile.id)
      .eq('status', 'abgeschlossen')
      .gte('finished_at', new Date(now.getTime() - 14 * DAY_MS).toISOString())
      .order('finished_at', { ascending: false })
      .limit(40),
    teamId
      ? supabase
          .from('activity_feed')
          .select('user_id, created_at, profiles!inner(full_name, avatar_url)')
          .eq('team_id', teamId)
          .eq('event_type', 'workout_completed')
          .neq('user_id', profile.id)
          .gte('created_at', new Date(Math.min(new Date(weekStart).getTime(), now.getTime() - DAY_MS)).toISOString())
          .order('created_at', { ascending: false })
          .limit(60)
      : Promise.resolve({ data: null }),
    teamId
      ? supabase
          .from('messages')
          .select('user_id, created_at, profiles(full_name, avatar_url)')
          .eq('team_id', teamId)
          .eq('message_type', 'system')
          .eq('event_type', 'weekly_goal_reached')
          .is('deleted_at', null)
          .neq('user_id', profile.id)
          .gte('created_at', sinceDay)
          .order('created_at', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: null }),
  ]);

  // ---- team highlight: newest public event of the last 24h ----
  type Actor = { full_name: string | null; avatar_url: string | null } | null;
  const feedRows = (feed.data ?? []) as unknown as { user_id: string; created_at: string; profiles: Actor }[];
  const weekCounts = new Map<string, number>();
  for (const r of feedRows) if (r.created_at >= weekStart) weekCounts.set(r.user_id, (weekCounts.get(r.user_id) ?? 0) + 1);
  const candidates: CoachTeamEvent[] = [];
  const latestDone = feedRows.find((r) => new Date(r.created_at).getTime() >= now.getTime() - DAY_MS);
  if (latestDone && firstNameOf(latestDone.profiles?.full_name)) {
    candidates.push({
      kind: 'workout_completed',
      firstName: firstNameOf(latestDone.profiles?.full_name),
      avatarUrl: latestDone.profiles?.avatar_url ?? null,
      at: new Date(latestDone.created_at).getTime(),
      weekCount: weekCounts.get(latestDone.user_id) ?? null,
    });
  }
  const goalRows = (goalEvents.data ?? []) as unknown as { user_id: string; created_at: string; profiles: Actor }[];
  const goal = goalRows.find((r) => firstNameOf(r.profiles?.full_name));
  if (goal) {
    candidates.push({
      kind: 'goal_reached',
      firstName: firstNameOf(goal.profiles?.full_name),
      avatarUrl: goal.profiles?.avatar_url ?? null,
      at: new Date(goal.created_at).getTime(),
      weekCount: weekCounts.get(goal.user_id) ?? null,
    });
  }
  candidates.sort((a, b) => b.at - a.at);
  const team = candidates[0] ?? null;

  // ---- streak ----
  const recentRows = (recent.data ?? []) as { id: string; title: string | null; duration_seconds: number | null; finished_at: string | null }[];
  const streakDays = computeStreakDays(
    recentRows.filter((w) => w.finished_at).map((w) => berlinDate(new Date(w.finished_at!))),
    berlinDate(now)
  );

  // ---- after-workout celebration (+ real personal record) ----
  let justFinished: ServerPart['justFinished'] = null;
  let record: ServerPart['record'] = null;
  const last = recentRows[0];
  if (last?.finished_at && now.getTime() - new Date(last.finished_at).getTime() <= CELEBRATION_WINDOW_MS) {
    const [{ data: pts }, { data: curEx }] = await Promise.all([
      supabase.from('fitness_score_events').select('points').eq('user_id', profile.id).eq('source_entity_id', last.id),
      supabase
        .from('workout_exercises')
        .select('exercise_id, exercises(name, exercise_type), workout_sets(weight_kg, distance_km, duration_seconds)')
        .eq('workout_id', last.id),
    ]);
    justFinished = {
      minutes: Math.max(1, Math.round((last.duration_seconds ?? 0) / 60)),
      points: (pts ?? []).reduce((sum, r) => sum + (r.points as number), 0),
    };

    type ExRow = { exercise_id: string; exercises: { name: string; exercise_type: ExerciseType } | null; workout_sets: { weight_kg: number | null; distance_km: number | null; duration_seconds: number | null }[] };
    const exRows = (curEx ?? []) as unknown as ExRow[];
    const toSets = (rows: ExRow[]): RecordSet[] =>
      rows.flatMap((r) => {
        const type = r.exercises ? normalizeExerciseType(r.exercises.exercise_type) : null;
        const kind = type === 'strength' ? 'strength' : type === 'cardio_distance' ? 'distance' : null;
        if (!kind || !r.exercises) return [];
        return r.workout_sets.map((s) => ({
          exerciseId: r.exercise_id,
          exerciseName: r.exercises!.name,
          kind,
          weightKg: s.weight_kg != null ? Number(s.weight_kg) : null,
          distanceKm: s.distance_km != null ? Number(s.distance_km) : null,
          durationSeconds: s.duration_seconds,
        }));
      });
    const current = toSets(exRows);
    if (current.length) {
      const ids = [...new Set(exRows.map((r) => r.exercise_id))];
      const { data: prevRows } = await supabase
        .from('workout_exercises')
        .select('exercise_id, exercises(name, exercise_type), workout_sets(weight_kg, distance_km, duration_seconds), workouts!inner(id, status, user_id)')
        .in('exercise_id', ids)
        .neq('workout_id', last.id)
        .eq('workouts.status', 'abgeschlossen')
        .eq('workouts.user_id', profile.id);
      record = detectPersonalRecord(current, toSets((prevRows ?? []) as unknown as ExRow[]));
    }
  }

  // ---- today / challenge from the dashboard data already loaded ----
  const day = dash.todayPlanDay;
  const tw = dash.todayWorkout;
  const today: ServerPart['today'] = day
    ? {
        planTitle: day.title ?? '',
        isRest: day.is_rest_day,
        alreadyDone: tw?.status === 'abgeschlossen',
        startHref: tw && tw.status !== 'abgeschlossen' ? `/aktivitaet/training/${tw.id}` : `/aktivitaet/training/neu?planDayId=${day.id}`,
      }
    : null;

  const ch = dash.activeChallenge;
  const challenge: ServerPart['challenge'] = ch
    ? {
        percent: ch.target_value > 0 ? (ch.myProgress / ch.target_value) * 100 : 0,
        remaining: Math.max(0, ch.target_value - ch.myProgress),
        unit: unitFor(ch.metric),
        completed: ch.myProgress >= ch.target_value,
      }
    : null;

  return {
    totalWorkouts: totalRes.count ?? 0,
    activeWorkout: active.data ? { id: active.data.id } : null,
    today,
    challenge,
    streakDays,
    rank: dash.rank,
    teamSize: dash.rankInfo.teamSize,
    pointsToNextRank: dash.rankInfo.pointsToNext,
    justFinished,
    record,
    team,
  };
}

function unitFor(metric: string): string | null {
  return METRIC_UNITS[metric] ?? null;
}
