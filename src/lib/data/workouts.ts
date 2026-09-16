import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Workout, WorkoutExercise, WorkoutSet, Exercise } from '@/types/database';

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
