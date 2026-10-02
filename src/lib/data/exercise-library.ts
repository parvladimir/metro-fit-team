import 'server-only';
import { createClient } from '@/lib/supabase/server';

/** Codes that mean "this table / function does not exist (yet)": PostgREST's schema-cache
 * misses and Postgres' undefined_table / undefined_function. */
const MISSING = new Set(['PGRST202', 'PGRST205', '42883', '42P01']);

export function isMissingObject(error: { code?: string } | null | undefined): boolean {
  return !!error?.code && MISSING.has(error.code);
}

export type ExerciseIdList =
  | { status: 'ok'; ids: string[] }
  /** The database has not been migrated yet: the tab / star stays hidden instead of failing when tapped. */
  | { status: 'unavailable' }
  | { status: 'error' };

/** The caller's own favourite exercises, newest first. An exercise that stopped being visible to the
 * caller (it is gone, or its team was left) resolves to nothing and is dropped here. */
export async function getFavoriteExerciseIds(): Promise<ExerciseIdList> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('exercise_favorites')
      .select('exercise_id, exercises(id)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return isMissingObject(error) ? { status: 'unavailable' } : { status: 'error' };
    const rows = (data ?? []) as unknown as Array<{ exercise_id: string; exercises: { id: string } | null }>;
    return { status: 'ok', ids: rows.filter((r) => r.exercises).map((r) => r.exercise_id) };
  } catch {
    return { status: 'error' };
  }
}

/** The caller's recently PERFORMED exercises (a recorded set), most recent first. */
export async function getRecentExerciseIds(limit = 12): Promise<ExerciseIdList> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('get_recent_exercises', { p_limit: limit });
    if (error) return isMissingObject(error) ? { status: 'unavailable' } : { status: 'error' };
    return { status: 'ok', ids: ((data ?? []) as Array<{ out_exercise_id: string }>).map((r) => r.out_exercise_id) };
  } catch {
    return { status: 'error' };
  }
}
