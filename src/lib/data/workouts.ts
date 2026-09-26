import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Workout, WorkoutExercise, WorkoutSet, Exercise } from '@/types/database';

export type ActiveWorkout = Pick<Workout, 'id' | 'title' | 'activity_type' | 'started_at' | 'paused_seconds' | 'paused_at'>;

/** The user's one running/paused workout, if any — for the shared app-shell
 * strip. There is at most one (enforced by a partial unique index), so this
 * is always a single cheap lookup, never per-page. */
export async function getActiveWorkout(userId: string): Promise<ActiveWorkout | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('workouts')
    .select('id, title, activity_type, started_at, paused_seconds, paused_at')
    .eq('user_id', userId)
    .eq('status', 'laeuft')
    .maybeSingle();
  return data as ActiveWorkout | null;
}

export async function getRecentWorkouts(userId: string, limit = 30): Promise<Workout[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('workouts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as Workout[];
}

export interface WorkoutExerciseWithSets extends WorkoutExercise {
  exercise: Exercise;
  sets: WorkoutSet[];
}

export interface WorkoutDetail extends Workout {
  workoutExercises: WorkoutExerciseWithSets[];
}

export async function getWorkoutDetail(workoutId: string): Promise<WorkoutDetail | null> {
  const supabase = await createClient();
  const { data: workout } = await supabase.from('workouts').select('*').eq('id', workoutId).maybeSingle();
  if (!workout) return null;

  const { data: exercises } = await supabase
    .from('workout_exercises')
    .select('*, exercises(*), workout_sets(*)')
    .eq('workout_id', workoutId)
    .order('position', { ascending: true });

  const workoutExercises: WorkoutExerciseWithSets[] = (exercises ?? []).map((row) => {
    const r = row as unknown as WorkoutExercise & { exercises: Exercise; workout_sets: WorkoutSet[] };
    return {
      ...r,
      exercise: r.exercises,
      sets: (r.workout_sets ?? []).sort((a, b) => a.set_number - b.set_number),
    };
  });

  return { ...(workout as Workout), workoutExercises };
}

export function calculateVolumeKg(workoutExercises: WorkoutExerciseWithSets[]): number {
  return workoutExercises.reduce((total, we) => {
    if (we.exercise.exercise_type !== 'strength') return total;
    const exerciseVolume = we.sets.reduce((sum, s) => sum + (s.weight_kg ?? 0) * (s.reps ?? 0), 0);
    return total + exerciseVolume;
  }, 0);
}
