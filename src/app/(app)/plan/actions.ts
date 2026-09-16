'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAuthUser } from '@/lib/data/profile';
import { getOrCreateActivePlan } from '@/lib/data/plan';

export async function saveDayAction(formData: FormData) {
  const user = await requireAuthUser();
  const supabase = await createClient();
  const plan = await getOrCreateActivePlan(user.id);

  const weekday = Number(formData.get('weekday'));
  const title = String(formData.get('title') || '').trim();
  const isRestDay = formData.get('isRestDay') === 'on';

  await supabase
    .from('workout_plan_days')
    .upsert({ plan_id: plan.id, weekday, title, is_rest_day: isRestDay }, { onConflict: 'plan_id,weekday' });

  revalidatePath('/plan');
  revalidatePath(`/plan/tag/${weekday}`);
}

export async function deleteDayAction(dayId: string, weekday: number) {
  'use server';
  await requireAuthUser();
  const supabase = await createClient();
  await supabase.from('workout_plan_days').delete().eq('id', dayId);
  revalidatePath('/plan');
  revalidatePath(`/plan/tag/${weekday}`);
}

export async function addExerciseToDayAction(formData: FormData) {
  const user = await requireAuthUser();
  const supabase = await createClient();
  const plan = await getOrCreateActivePlan(user.id);

  const weekday = Number(formData.get('weekday'));
  const exerciseId = String(formData.get('exerciseId'));
  const targetSets = Number(formData.get('targetSets') || 3);
  const targetReps = Number(formData.get('targetReps') || 10);
  const title = String(formData.get('title') || '');

  const { data: day } = await supabase
    .from('workout_plan_days')
    .upsert({ plan_id: plan.id, weekday, title }, { onConflict: 'plan_id,weekday', ignoreDuplicates: false })
    .select('id')
    .single();

  const dayId = day!.id as string;

  const { count } = await supabase
    .from('workout_plan_exercises')
    .select('id', { count: 'exact', head: true })
    .eq('plan_day_id', dayId);

  await supabase.from('workout_plan_exercises').insert({
    plan_day_id: dayId,
    exercise_id: exerciseId,
    position: count ?? 0,
    target_sets: targetSets,
    target_reps: targetReps,
  });

  revalidatePath(`/plan/tag/${weekday}`);
}

export async function removeExerciseFromDayAction(planExerciseId: string, weekday: number) {
  'use server';
  await requireAuthUser();
  const supabase = await createClient();
  await supabase.from('workout_plan_exercises').delete().eq('id', planExerciseId);
  revalidatePath(`/plan/tag/${weekday}`);
}
