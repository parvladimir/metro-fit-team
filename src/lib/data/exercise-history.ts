import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseHistorySets, type HistoryEntry } from '@/lib/exercise-history';

/** PostgREST / Postgres codes for "this function does not exist (yet)". */
const MISSING_FUNCTION = new Set(['PGRST202', '42883']);

export function isMissingFunction(error: { code?: string } | null | undefined): boolean {
  return !!error?.code && MISSING_FUNCTION.has(error.code);
}

export type LastResultsLoad =
  /** One entry per exercise that has an earlier completed session. */
  | { status: 'ok'; byExercise: Record<string, HistoryEntry> }
  /** The database has not been migrated yet: the feature stays hidden instead of showing broken controls. */
  | { status: 'unavailable' }
  /** The lookup failed: "no earlier entry" must not be claimed. */
  | { status: 'error' };

interface LastRow {
  out_exercise_id: string;
  out_workout_id: string;
  out_workout_exercise_id: string;
  out_performed_at: string;
  out_sets: unknown;
}

/** The user's own most recent completed result per exercise of one workout — a
 * single batched call, never one query per exercise card. */
export async function getLastExerciseResults(workoutId: string): Promise<LastResultsLoad> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('get_last_exercise_results', { p_workout_id: workoutId });
    if (error) return isMissingFunction(error) ? { status: 'unavailable' } : { status: 'error' };

    const byExercise: Record<string, HistoryEntry> = {};
    for (const row of (data ?? []) as LastRow[]) {
      const sets = parseHistorySets(row.out_sets);
      if (sets.length === 0) continue;
      byExercise[row.out_exercise_id] = {
        workoutId: row.out_workout_id,
        workoutExerciseId: row.out_workout_exercise_id,
        performedAt: row.out_performed_at,
        instanceNo: 1,
        instanceCount: 1,
        sets,
      };
    }
    return { status: 'ok', byExercise };
  } catch {
    return { status: 'error' };
  }
}

interface HistoryRow extends LastRow {
  out_instance_no: number;
  out_instance_count: number;
}

export const HISTORY_PAGE_SIZE = 5;

export type ExerciseHistoryPage =
  | { status: 'ok'; entries: HistoryEntry[]; hasMore: boolean }
  | { status: 'unavailable' }
  | { status: 'error' };

/** The user's own earlier completed sessions of one exercise, newest first (one page). */
export async function getExerciseHistory(exerciseId: string, excludeWorkoutId: string | null, before: string | null): Promise<ExerciseHistoryPage> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('get_exercise_history', {
      p_exercise_id: exerciseId,
      p_exclude_workout_id: excludeWorkoutId,
      p_limit: HISTORY_PAGE_SIZE,
      p_before: before,
    });
    if (error) return isMissingFunction(error) ? { status: 'unavailable' } : { status: 'error' };

    const rows = (data ?? []) as Array<Omit<HistoryRow, 'out_exercise_id'> & { out_exercise_id?: string }>;
    const entries: HistoryEntry[] = rows
      .map((row) => ({
        workoutId: row.out_workout_id,
        workoutExerciseId: row.out_workout_exercise_id,
        performedAt: row.out_performed_at,
        instanceNo: row.out_instance_no,
        instanceCount: row.out_instance_count,
        sets: parseHistorySets(row.out_sets),
      }))
      .filter((e) => e.sets.length > 0);
    const workouts = new Set(rows.map((r) => r.out_workout_id));
    return { status: 'ok', entries, hasMore: workouts.size >= HISTORY_PAGE_SIZE };
  } catch {
    return { status: 'error' };
  }
}
