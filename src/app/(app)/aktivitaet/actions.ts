'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAuthUser, getPrimaryTeamMembership } from '@/lib/data/profile';
import type { ActivityType } from '@/types/database';

export async function createWorkoutAction(formData: FormData) {
  const user = await requireAuthUser();
  const supabase = await createClient();
  const membership = await getPrimaryTeamMembership(user.id);

  const activityType = String(formData.get('activityType') || 'krafttraining') as ActivityType;
  const title = String(formData.get('title') || '').trim() || null;
  const planDayId = String(formData.get('planDayId') || '') || null;
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('workouts')
    .insert({
      user_id: user.id,
      team_id: membership?.team_id ?? null,
      plan_day_id: planDayId,
      activity_type: activityType,
      title,
      status: 'laeuft',
      scheduled_date: today,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !data) throw new Error('Training konnte nicht erstellt werden.');

  redirect(`/aktivitaet/training/${data.id}`);
}

export async function addWorkoutExerciseAction(formData: FormData) {
  const workoutId = String(formData.get('workoutId'));
  const exerciseId = String(formData.get('exerciseId'));
  await requireAuthUser();
  const supabase = await createClient();

  const { count } = await supabase
    .from('workout_exercises')
    .select('id', { count: 'exact', head: true })
    .eq('workout_id', workoutId);

  await supabase.from('workout_exercises').insert({ workout_id: workoutId, exercise_id: exerciseId, position: count ?? 0 });
  revalidatePath(`/aktivitaet/training/${workoutId}`);
}

export async function addSetAction(formData: FormData) {
  const workoutId = String(formData.get('workoutId'));
  const workoutExerciseId = String(formData.get('workoutExerciseId'));
  const weight = formData.get('weight') ? Number(formData.get('weight')) : null;
  const reps = formData.get('reps') ? Number(formData.get('reps')) : null;
  await requireAuthUser();
  const supabase = await createClient();

  const { count } = await supabase
    .from('workout_sets')
    .select('id', { count: 'exact', head: true })
    .eq('workout_exercise_id', workoutExerciseId);

  await supabase.from('workout_sets').insert({
    workout_exercise_id: workoutExerciseId,
    set_number: (count ?? 0) + 1,
    weight_kg: weight,
    reps,
  });
  revalidatePath(`/aktivitaet/training/${workoutId}`);
}

export async function deleteSetAction(setId: string, workoutId: string) {
  'use server';
  await requireAuthUser();
  const supabase = await createClient();
  await supabase.from('workout_sets').delete().eq('id', setId);
  revalidatePath(`/aktivitaet/training/${workoutId}`);
}

export async function finishWorkoutAction(formData: FormData) {
  const workoutId = String(formData.get('workoutId'));
  const notes = String(formData.get('notes') || '').trim() || null;
  const distanceRaw = String(formData.get('distanceKm') || '').trim();

  const user = await requireAuthUser();
  const supabase = await createClient();

  const { data: workout } = await supabase.from('workouts').select('started_at').eq('id', workoutId).single();
  const startedAt = workout?.started_at ? new Date(workout.started_at) : new Date();
  const finishedAt = new Date();
  const durationSeconds = Math.max(1, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000));

  await supabase
    .from('workouts')
    .update({
      status: 'abgeschlossen',
      finished_at: finishedAt.toISOString(),
      duration_seconds: durationSeconds,
      notes,
      distance_km: distanceRaw ? Number(distanceRaw) : null,
    })
    .eq('id', workoutId)
    .eq('user_id', user.id);

  redirect(`/aktivitaet/training/${workoutId}/zusammenfassung`);
}

export async function skipWorkoutAction(workoutId: string) {
  'use server';
  const user = await requireAuthUser();
  const supabase = await createClient();
  await supabase.from('workouts').update({ status: 'uebersprungen' }).eq('id', workoutId).eq('user_id', user.id);
  redirect('/aktivitaet');
}

export async function discardWorkoutAction(workoutId: string) {
  'use server';
  const user = await requireAuthUser();
  const supabase = await createClient();
  await supabase.from('workouts').delete().eq('id', workoutId).eq('user_id', user.id);
  redirect('/aktivitaet');
}

export async function addMeasurementAction(formData: FormData) {
  const user = await requireAuthUser();
  const supabase = await createClient();

  const measuredAt = String(formData.get('measuredAt') || new Date().toISOString().slice(0, 10));
  const fields = ['weight_kg', 'biceps_cm', 'waist_cm', 'chest_cm', 'hip_cm', 'thigh_cm', 'body_fat_pct', 'neck_cm'];
  const payload: Record<string, unknown> = { user_id: user.id, measured_at: measuredAt };

  for (const field of fields) {
    const raw = String(formData.get(field) || '').trim();
    payload[field] = raw ? Number(raw) : null;
  }
  payload.notes = String(formData.get('notes') || '').trim() || null;

  await supabase.from('body_measurements').upsert(payload, { onConflict: 'user_id,measured_at' });
  redirect('/aktivitaet?tab=messungen');
}

export async function logActivityAction(formData: FormData) {
  const user = await requireAuthUser();
  const supabase = await createClient();
  const membership = await getPrimaryTeamMembership(user.id);

  const activityType = String(formData.get('activityType') || 'sonstiges') as ActivityType;
  const durationMin = String(formData.get('durationMinutes') || '').trim();
  const distance = String(formData.get('distanceKm') || '').trim();
  const steps = String(formData.get('steps') || '').trim();

  await supabase.from('activities').insert({
    user_id: user.id,
    team_id: membership?.team_id ?? null,
    activity_type: activityType,
    occurred_at: new Date().toISOString(),
    duration_seconds: durationMin ? Number(durationMin) * 60 : null,
    distance_km: distance ? Number(distance) : null,
    steps: steps ? Number(steps) : null,
    notes: String(formData.get('notes') || '').trim() || null,
  });

  redirect('/aktivitaet');
}
