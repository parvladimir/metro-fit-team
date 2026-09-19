'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAuthUser, getPrimaryTeamMembership } from '@/lib/data/profile';
import { parseDuration } from '@/lib/workout-metrics';
import { buildSetEdit, localDateString, shiftByDays, type SetValues } from '@/lib/set-input';
import { normalizeExerciseType } from '@/lib/exercise-types';
import { hasTargets, targetsFromRow } from '@/lib/plan-targets';
import type { ActivityType, ExerciseType, SetMetrics } from '@/types/database';

export async function createWorkoutAction(formData: FormData) {
  const user = await requireAuthUser();
  const supabase = await createClient();
  const membership = await getPrimaryTeamMembership(user.id);

  const activityType = String(formData.get('activityType') || 'krafttraining') as ActivityType;
  let title = String(formData.get('title') || '').trim() || null;
  const planDayId = String(formData.get('planDayId') || '') || null;
  const today = new Date().toISOString().slice(0, 10);

  // Starting from a plan day: default the title to the day's title and later
  // copy its exercises into the new workout.
  if (planDayId && !title) {
    const { data: day } = await supabase.from('workout_plan_days').select('title').eq('id', planDayId).maybeSingle();
    title = day?.title?.trim() || null;
  }

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

  if (planDayId) {
    const { data: planned } = await supabase
      .from('workout_plan_exercises')
      .select('exercise_id, position, target_sets, target_reps, target_weight_kg, target_duration_seconds, target_distance_km, target_metrics, exercises(exercise_type)')
      .eq('plan_day_id', planDayId)
      .order('position', { ascending: true });
    if (planned && planned.length > 0) {
      await supabase
        .from('workout_exercises')
        .insert(
          planned.map((p, i) => {
            const type = (p as unknown as { exercises: { exercise_type: ExerciseType } | null }).exercises?.exercise_type ?? 'other';
            const targets = targetsFromRow(type, p);
            return { workout_id: data.id, exercise_id: p.exercise_id, position: i, planned: hasTargets(targets) ? targets : null };
          }),
        );
    }
  }

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

export type AddSetState = { error?: string; ok?: number } | undefined;

function readNumber(formData: FormData, key: string, min: number, max: number): number | null | 'invalid' {
  const raw = String(formData.get(key) ?? '').trim().replace(',', '.');
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) return 'invalid';
  return value;
}

/** Logs one set / cardio entry. Which fields are accepted depends on the
 * exercise type (looked up server-side, never trusted from the form). */
export async function addSetAction(_prev: AddSetState, formData: FormData): Promise<AddSetState> {
  const workoutId = String(formData.get('workoutId'));
  const workoutExerciseId = String(formData.get('workoutExerciseId'));
  await requireAuthUser();
  const supabase = await createClient();

  const { data: we } = await supabase
    .from('workout_exercises')
    .select('id, exercises(exercise_type)')
    .eq('id', workoutExerciseId)
    .maybeSingle();
  if (!we) return { error: 'Übung nicht gefunden.' };
  const rawType = (we as unknown as { exercises: { exercise_type: ExerciseType } }).exercises.exercise_type;
  const type = normalizeExerciseType(rawType);

  const fields = {
    weight: readNumber(formData, 'weight', 0, 9999),
    reps: readNumber(formData, 'reps', 0, 10000),
    distance: readNumber(formData, 'distanceKm', 0, 9999),
    rpe: readNumber(formData, 'rpe', 1, 10),
    rest: readNumber(formData, 'restSeconds', 0, 3600),
    calories: readNumber(formData, 'calories', 0, 20000),
    avgHr: readNumber(formData, 'avgHeartRate', 30, 250),
    maxHr: readNumber(formData, 'maxHeartRate', 30, 250),
    elevation: readNumber(formData, 'elevationGainM', 0, 20000),
    incline: readNumber(formData, 'inclinePct', 0, 100),
    rounds: readNumber(formData, 'rounds', 1, 500),
    work: readNumber(formData, 'workSeconds', 1, 3600),
    intervalRest: readNumber(formData, 'intervalRestSeconds', 0, 3600),
  };
  if (Object.values(fields).includes('invalid')) return { error: 'Bitte prüfe deine Eingaben.' };
  const f = fields as Record<keyof typeof fields, number | null>;

  const durationRaw = String(formData.get('duration') || '').trim();
  let duration: number | null = null;
  if (durationRaw) {
    duration = parseDuration(durationRaw);
    if (duration === null || duration > 24 * 3600) return { error: 'Zeit bitte als mm:ss oder h:mm:ss eingeben.' };
  }

  const set: Record<string, unknown> = {};
  const metrics: Record<string, number> = {};
  if (f.calories !== null) metrics.calories = f.calories;
  if (f.avgHr !== null) metrics.avg_heart_rate = f.avgHr;
  if (f.maxHr !== null) metrics.max_heart_rate = f.maxHr;

  if (type === 'strength') {
    if (f.reps === null || f.weight === null) return { error: 'Gewicht und Wiederholungen sind nötig.' };
    set.weight_kg = f.weight;
    set.reps = f.reps;
    if (f.rpe !== null) metrics.rpe = f.rpe;
    if (f.rest !== null) metrics.rest_seconds = f.rest;
  } else if (type === 'bodyweight') {
    if (f.reps === null && duration === null) return { error: 'Wiederholungen oder Dauer angeben.' };
    set.reps = f.reps;
    set.duration_seconds = duration;
    set.weight_kg = f.weight; // optional Zusatzgewicht
    if (f.rpe !== null) metrics.rpe = f.rpe;
  } else if (type === 'cardio_distance') {
    if (duration === null && f.distance === null) return { error: 'Zeit oder Distanz angeben.' };
    set.duration_seconds = duration;
    set.distance_km = f.distance;
    if (f.elevation !== null) metrics.elevation_gain_m = f.elevation;
    if (f.incline !== null) metrics.incline_pct = f.incline;
  } else if (type === 'interval') {
    if (f.rounds === null || f.work === null) return { error: 'Runden und Belastungszeit angeben.' };
    metrics.rounds = f.rounds;
    metrics.work_seconds = f.work;
    if (f.intervalRest !== null) metrics.interval_rest_seconds = f.intervalRest;
    set.duration_seconds = duration ?? f.rounds * (f.work + (f.intervalRest ?? 0));
  } else {
    // cardio_time, mobility, sport, other
    if (duration === null) return { error: 'Bitte eine Dauer angeben.' };
    set.duration_seconds = duration;
  }

  const notes = String(formData.get('notes') || '').trim().slice(0, 500) || null;

  const { count } = await supabase
    .from('workout_sets')
    .select('id', { count: 'exact', head: true })
    .eq('workout_exercise_id', workoutExerciseId);

  const { error } = await supabase.from('workout_sets').insert({
    workout_exercise_id: workoutExerciseId,
    set_number: (count ?? 0) + 1,
    metrics,
    notes,
    ...set,
  });
  if (error) return { error: 'Eintrag konnte nicht gespeichert werden.' };

  revalidatePath(`/aktivitaet/training/${workoutId}`);
  return { ok: Date.now() };
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

  let distanceKm: number | null = distanceRaw ? Number(distanceRaw) : null;
  if (distanceKm === null) {
    const { data: sets } = await supabase
      .from('workout_sets')
      .select('distance_km, workout_exercises!inner(workout_id)')
      .eq('workout_exercises.workout_id', workoutId);
    const total = (sets ?? []).reduce((sum, r) => sum + Number((r as { distance_km: number | null }).distance_km ?? 0), 0);
    distanceKm = total > 0 ? Math.round(total * 100) / 100 : null;
  }

  await supabase
    .from('workouts')
    .update({
      status: 'abgeschlossen',
      finished_at: finishedAt.toISOString(),
      duration_seconds: durationSeconds,
      notes,
      distance_km: distanceKm,
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

export type EditWorkoutState = { error?: string } | undefined;

/** Edits the caller's own completed workout IN PLACE (same id): workout fields,
 * exercises and sets. Ownership is enforced by RLS on the child rows and by
 * update_own_workout(), which also rebuilds everything derived from the
 * workout (team event text, score ledger/totals, challenge progress). */
export async function updateWorkoutAction(_prev: EditWorkoutState, formData: FormData): Promise<EditWorkoutState> {
  const workoutId = String(formData.get('workoutId') || '');
  const user = await requireAuthUser();
  const supabase = await createClient();

  const { data: workout } = await supabase
    .from('workouts')
    .select('id, user_id, status, finished_at')
    .eq('id', workoutId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!workout || workout.status !== 'abgeschlossen' || !workout.finished_at) return { error: 'Training nicht gefunden.' };

  const durationSeconds = parseDuration(String(formData.get('duration') || ''));
  if (!durationSeconds || durationSeconds < 1 || durationSeconds > 24 * 3600) return { error: 'Dauer bitte als mm:ss oder h:mm:ss eingeben.' };

  const date = String(formData.get('date') || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Bitte ein gültiges Datum wählen.' };
  const original = new Date(workout.finished_at);
  const finishedAt = shiftByDays(original, localDateString(original), date);
  if (finishedAt.getTime() > Date.now() + 3600_000) return { error: 'Das Datum darf nicht in der Zukunft liegen.' };

  const { data: exercises } = await supabase
    .from('workout_exercises')
    .select('id, exercises(exercise_type), workout_sets(id, metrics, distance_km)')
    .eq('workout_id', workoutId);

  type Row = { id: string; exercises: { exercise_type: ExerciseType }; workout_sets: { id: string; metrics: SetMetrics; distance_km: number | null }[] };
  let distanceFromSets = 0;
  const sets: { id: string; values: SetValues; metrics: SetMetrics }[] = [];
  const removeSets: string[] = [];
  const removeExercises: string[] = [];

  for (const ex of (exercises ?? []) as unknown as Row[]) {
    if (formData.get(`ex-${ex.id}-remove`) === 'on') {
      removeExercises.push(ex.id);
      continue;
    }
    for (const s of ex.workout_sets) {
      if (formData.get(`set-${s.id}-remove`) === 'on') {
        removeSets.push(s.id);
        continue;
      }
      const res = buildSetEdit(ex.exercises.exercise_type, (f) => String(formData.get(`set-${s.id}-${f}`) ?? ''), s.metrics ?? {});
      if (!res.ok) return { error: res.error };
      sets.push({ id: s.id, values: res.values, metrics: res.metrics });
      distanceFromSets += res.values.distance_km ?? 0;
    }
  }

  const explicitDistanceRaw = String(formData.get('distanceKm') || '').trim().replace(',', '.');
  let distanceKm: number | null = null;
  if (distanceFromSets > 0) distanceKm = Math.round(distanceFromSets * 100) / 100;
  else if (explicitDistanceRaw) {
    const d = Number(explicitDistanceRaw);
    if (!Number.isFinite(d) || d < 0 || d > 9999) return { error: 'Bitte prüfe die Distanz.' };
    distanceKm = d;
  }

  if (removeExercises.length) await supabase.from('workout_exercises').delete().in('id', removeExercises);
  if (removeSets.length) await supabase.from('workout_sets').delete().in('id', removeSets);
  for (const s of sets) {
    const { error } = await supabase.from('workout_sets').update({ ...s.values, metrics: s.metrics }).eq('id', s.id);
    if (error) return { error: 'Änderungen konnten nicht gespeichert werden.' };
  }

  const { error } = await supabase.rpc('update_own_workout', {
    p_workout_id: workoutId,
    p_title: String(formData.get('title') || '').slice(0, 120),
    p_finished_at: finishedAt.toISOString(),
    p_duration_seconds: durationSeconds,
    p_distance_km: distanceKm,
    p_notes: String(formData.get('notes') || '').slice(0, 500),
  });
  if (error) return { error: 'Training konnte nicht gespeichert werden.' };

  revalidatePath('/aktivitaet');
  revalidatePath('/team');
  redirect(`/aktivitaet/training/${workoutId}/zusammenfassung`);
}

/** Deletes the caller's own workout together with everything derived from it
 * (see delete_own_workout): team events with their reactions/replies, feed
 * entries, score effects, challenge progress. */
export async function deleteWorkoutAction(workoutId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(workoutId)) return;
  await requireAuthUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_own_workout', { p_workout_id: workoutId });
  if (error) throw new Error('Training konnte nicht gelöscht werden.');
  revalidatePath('/aktivitaet');
  revalidatePath('/team');
  revalidatePath('/team/chat');
  redirect('/aktivitaet');
}
