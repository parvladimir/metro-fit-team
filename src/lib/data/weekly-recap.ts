import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { berlinPreviousWeekRange, berlinWeekRange, localDayKey, APP_TIMEZONE } from '@/lib/date';
import { computeStreakDays, detectPersonalRecord, type RecordSet } from '@/lib/coach';
import { normalizeExerciseType } from '@/lib/exercise-types';
import { notifyWeeklyRecapReady } from '@/lib/server/push';
import type { Profile, ExerciseType, PersonalWeeklyRecap, TeamWeeklyRecap } from '@/types/database';

export interface WeeklyRecapResult {
  personal: PersonalWeeklyRecap | null;
  team: TeamWeeklyRecap | null;
}

type ExRow = {
  exercise_id: string;
  exercises: { name: string; exercise_type: ExerciseType } | null;
  workout_sets: { weight_kg: number | null; distance_km: number | null; duration_seconds: number | null }[];
};

function toRecordSets(rows: ExRow[]): RecordSet[] {
  return rows.flatMap((r) => {
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
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/** Computes this user's recap numbers for one Berlin week and upserts them
 * (insert on first generation, in-place update on a later correction — same
 * row either way, via the unique(user_id, iso_year, iso_week) constraint).
 * Sends the "ready" push only when the row is brand new or was never
 * successfully notified before; a correction to an already-notified week
 * silently refreshes the numbers without a second push. */
async function regeneratePersonalRecap(
  supabase: SupabaseClient,
  profile: Profile,
  teamId: string | null,
  weekStart: string,
  start: Date,
  end: Date
): Promise<PersonalWeeklyRecap | null> {
  const { data: weekWorkouts } = await supabase
    .from('workouts')
    .select('id, duration_seconds, finished_at')
    .eq('user_id', profile.id)
    .eq('status', 'abgeschlossen')
    .gte('finished_at', start.toISOString())
    .lt('finished_at', end.toISOString());

  const rows = weekWorkouts ?? [];
  const completedWorkouts = rows.length;
  const minutes = Math.round(rows.reduce((sum, w) => sum + (w.duration_seconds ?? 0), 0) / 60);
  const weeklyGoal = profile.weekly_goal;
  const goalAchieved = weeklyGoal > 0 && completedWorkouts >= weeklyGoal;

  let points = 0;
  if (teamId) {
    const { data: rankingRows } = await supabase.rpc('get_team_ranking', { p_team_id: teamId, p_period: 'last_week' });
    const mine = ((rankingRows ?? []) as { user_id: string; points: number }[]).find((r) => r.user_id === profile.id);
    points = Number(mine?.points ?? 0);
  }

  // Personal record: "current" is every set from this week's workouts (not
  // just one, unlike getCoachData's single-just-finished-workout version —
  // detectPersonalRecord already takes the max across however many current
  // sets share an exercise id, so widening "current" to a whole week needs
  // no change to the function itself); "previous" is every set from
  // completed workouts strictly before the week.
  let personalRecordTitle: string | null = null;
  let personalRecordDetail: string | null = null;
  if (rows.length > 0) {
    const { data: curEx } = await supabase
      .from('workout_exercises')
      .select('exercise_id, exercises(name, exercise_type), workout_sets(weight_kg, distance_km, duration_seconds)')
      .in('workout_id', rows.map((w) => w.id));
    const current = toRecordSets((curEx ?? []) as unknown as ExRow[]);
    if (current.length > 0) {
      const ids = [...new Set(current.map((c) => c.exerciseId))];
      const { data: prevEx } = await supabase
        .from('workout_exercises')
        .select('exercise_id, exercises(name, exercise_type), workout_sets(weight_kg, distance_km, duration_seconds), workouts!inner(status, user_id, finished_at)')
        .in('exercise_id', ids)
        .eq('workouts.status', 'abgeschlossen')
        .eq('workouts.user_id', profile.id)
        .lt('workouts.finished_at', start.toISOString());
      const record = detectPersonalRecord(current, toRecordSets((prevEx ?? []) as unknown as ExRow[]));
      if (record) {
        personalRecordTitle = record.title;
        personalRecordDetail = record.detail;
      }
    }
  }

  // Streak through the end of the recapped week (not "today" — a finished
  // week's recap describes that week, not the user's current streak).
  const { data: historyRows } = await supabase
    .from('workouts')
    .select('finished_at')
    .eq('user_id', profile.id)
    .eq('status', 'abgeschlossen')
    .lt('finished_at', end.toISOString());
  const finishedDates = (historyRows ?? [])
    .filter((w): w is { finished_at: string } => !!w.finished_at)
    .map((w) => localDayKey(new Date(w.finished_at), APP_TIMEZONE));
  const weekEndLocalDay = localDayKey(new Date(end.getTime() - 1), APP_TIMEZONE);
  const streakDays = computeStreakDays(finishedDates, weekEndLocalDay);

  const { data: upserted } = await supabase.rpc('upsert_personal_weekly_recap', {
    p_week_start: weekStart,
    p_team_id: teamId,
    p_completed_workouts: completedWorkouts,
    p_minutes: minutes,
    p_points: points,
    p_weekly_goal: weeklyGoal,
    p_goal_achieved: goalAchieved,
    p_personal_record_title: personalRecordTitle,
    p_personal_record_detail: personalRecordDetail,
    p_streak_days: streakDays,
  });
  const row = ((upserted ?? []) as { id: string; is_new: boolean }[])[0];
  if (!row) return null;

  const { data: fresh } = await supabase.from('personal_weekly_recaps').select('*').eq('id', row.id).single();
  const personal = fresh as PersonalWeeklyRecap | null;
  if (personal && (row.is_new || !personal.notified_at)) {
    await notifyWeeklyRecapReady({ userId: profile.id, completedWorkouts, points });
    await supabase.rpc('mark_weekly_recap_notified', { p_id: row.id });
    personal.notified_at = new Date().toISOString();
  }
  return personal;
}

async function regenerateTeamRecap(supabase: SupabaseClient, teamId: string, weekStart: string, start: Date, end: Date): Promise<TeamWeeklyRecap | null> {
  const { data: summaryRows } = await supabase.rpc('get_team_week_summary', {
    p_team_id: teamId,
    p_range_start: start.toISOString(),
    p_range_end: end.toISOString(),
  });
  const summary = ((summaryRows ?? []) as { completed_workouts: number; active_members: number; members_goal_reached: number }[])[0];
  if (!summary) return null;

  const { data: upsertedTeam } = await supabase.rpc('upsert_team_weekly_recap', {
    p_team_id: teamId,
    p_week_start: weekStart,
    p_completed_workouts: summary.completed_workouts,
    p_active_members: summary.active_members,
    p_members_goal_reached: summary.members_goal_reached,
  });
  const teamRow = ((upsertedTeam ?? []) as { id: string }[])[0];
  if (!teamRow) return null;

  const { data: freshTeam } = await supabase.from('team_weekly_recaps').select('*').eq('id', teamRow.id).single();
  return freshTeam as TeamWeeklyRecap | null;
}

/**
 * Generates last week's personal + team recap the first time anyone needs
 * them after the week has ended, then never again — both tables are upserted
 * via SECURITY DEFINER functions keyed `unique(..., iso_year, iso_week)`, so
 * a second call for the same week is a cheap existence check, not a
 * recompute. No scheduled infrastructure exists in this project; this
 * lazy-on-first-visit approach is the spec's own pre-approved fallback for
 * that gap.
 */
export async function ensureWeeklyRecapGenerated(profile: Profile, teamId: string | null): Promise<WeeklyRecapResult> {
  const supabase = await createClient();
  const { start, end } = berlinPreviousWeekRange();
  // The Berlin calendar day of `start`, NOT start.toISOString().slice(0, 10) —
  // that would read the UTC date of a Berlin-midnight instant, which during
  // CEST is still the previous day (the exact class of error this session's
  // points_reset_at/Heute-im-Team work already went out of its way to avoid).
  const weekStart = localDayKey(start, APP_TIMEZONE);

  const [{ data: existingPersonal }, { data: existingTeam }] = await Promise.all([
    supabase.from('personal_weekly_recaps').select('*').eq('user_id', profile.id).eq('week_start', weekStart).maybeSingle(),
    teamId
      ? supabase.from('team_weekly_recaps').select('*').eq('team_id', teamId).eq('week_start', weekStart).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  let personal = existingPersonal as PersonalWeeklyRecap | null;
  let team = existingTeam as TeamWeeklyRecap | null;

  if (!personal) {
    personal = await regeneratePersonalRecap(supabase, profile, teamId, weekStart, start, end);
  } else if (!personal.notified_at) {
    // Already generated on an earlier visit, but a previous push attempt
    // failed (or there was no subscription yet) — retry with the
    // already-computed numbers, no recomputation needed.
    await notifyWeeklyRecapReady({ userId: profile.id, completedWorkouts: personal.completed_workouts, points: personal.points });
    await supabase.rpc('mark_weekly_recap_notified', { p_id: personal.id });
    personal = { ...personal, notified_at: new Date().toISOString() };
  }

  if (!team && teamId) {
    team = await regenerateTeamRecap(supabase, teamId, weekStart, start, end);
  }

  return { personal, team };
}

/**
 * If a recap already exists for the Berlin week containing `finishedAt`,
 * refreshes it in place with freshly computed numbers — mirrors
 * `update_own_workout`'s own "update existing rows in place, never
 * reinsert" pattern one level up. A no-op when no recap exists yet for that
 * week: nothing to correct, and the normal lazy path will compute it
 * correctly from current data whenever it does eventually run. Never sends
 * a second "ready" push for an already-notified week (see
 * `regeneratePersonalRecap`'s own `is_new`/`notified_at` check).
 */
export async function refreshWeeklyRecapIfExists(profile: Profile, teamId: string | null, finishedAt: Date): Promise<void> {
  const supabase = await createClient();
  const { start, end } = berlinWeekRange(finishedAt);
  const weekStart = localDayKey(start, APP_TIMEZONE);

  const { data: existingPersonal } = await supabase
    .from('personal_weekly_recaps')
    .select('id')
    .eq('user_id', profile.id)
    .eq('week_start', weekStart)
    .maybeSingle();
  if (existingPersonal) await regeneratePersonalRecap(supabase, profile, teamId, weekStart, start, end);

  if (teamId) {
    const { data: existingTeam } = await supabase.from('team_weekly_recaps').select('id').eq('team_id', teamId).eq('week_start', weekStart).maybeSingle();
    if (existingTeam) await regenerateTeamRecap(supabase, teamId, weekStart, start, end);
  }
}
