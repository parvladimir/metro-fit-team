import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { WorkoutPlan, WorkoutPlanDay, WorkoutPlanExercise, Exercise } from '@/types/database';

export async function getOrCreateActivePlan(userId: string): Promise<WorkoutPlan> {
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('workout_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (existing) return existing as WorkoutPlan;

  const { data: created, error } = await supabase
    .from('workout_plans')
    .insert({ user_id: userId, name: 'Standardplan', is_active: true })
    .select('*')
    .single();

  if (error) throw error;
  return created as WorkoutPlan;
}

export interface PlanDayWithExercises extends WorkoutPlanDay {
  exercises: (WorkoutPlanExercise & { exercise: Exercise })[];
}

export async function getPlanDays(planId: string): Promise<PlanDayWithExercises[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('workout_plan_days')
    .select('*, workout_plan_exercises(*, exercises(*))')
    .eq('plan_id', planId)
    .order('weekday', { ascending: true });

  return (data ?? []).map((day) => ({
    ...(day as unknown as WorkoutPlanDay),
    exercises: ((day as unknown as { workout_plan_exercises: (WorkoutPlanExercise & { exercises: Exercise })[] }).workout_plan_exercises ?? [])
      .map((e) => ({ ...e, exercise: e.exercises }))
      .sort((a, b) => a.position - b.position),
  }));
}

export async function getPlanDay(planId: string, weekday: number): Promise<PlanDayWithExercises | null> {
  const days = await getPlanDays(planId);
  return days.find((d) => d.weekday === weekday) ?? null;
}

export async function getExerciseCatalogue(teamId: string | null): Promise<Exercise[]> {
  const supabase = await createClient();
  let query = supabase.from('exercises').select('*').order('name', { ascending: true });
  query = teamId ? query.or(`team_id.is.null,team_id.eq.${teamId}`) : query.is('team_id', null);
  const { data } = await query;
  return (data ?? []) as Exercise[];
}
