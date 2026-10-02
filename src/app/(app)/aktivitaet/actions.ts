'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAuthUser, getCurrentProfile, getPrimaryTeamMembership } from '@/lib/data/profile';
import { parseDuration } from '@/lib/workout-metrics';
import { buildSetEdit, localDateString, shiftByDays, type SetValues } from '@/lib/set-input';
import { setLocalTimeOfDay } from '@/lib/date';
import { normalizeExerciseType } from '@/lib/exercise-types';
import { hasTargets, targetsFromRow } from '@/lib/plan-targets';
import { refreshWeeklyRecapIfExists } from '@/lib/data/weekly-recap';
import type { ActivityType, ExerciseType, SetMetrics } from '@/types/database';

/** A workout correction may move it into a different week, or the week it's
 * already in may have been recapped — refresh whichever week(s) already
 * have a recap, in place. Never allowed to break the action it's called
 * from: a recap refresh is a nice-to-have, not the thing the user asked to
 * do. */
async function refreshAffectedRecaps(teamId: string | null, dates: (Date | null)[]) {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return;
    const seen = new Set<string>();
    for (const d of dates) {
      if (!d) continue;
      const key = d.toISOString().slice(0, 10);
      if (seen.has(key)) continue;
      seen.add(key);
      await refreshWeeklyRecapIfExists(profile, teamId, d);
    }
  } catch {
    // never let a recap refresh break the workout action it's attached to
  }
}

export async function createWorkoutAction(formData: FormData) {
  const user = await requireAuthUser();
  const supabase = await createClient();
  const membership = await getPrimaryTeamMembership(user.id);

  const activityType = String(formData.get('activityType') || 'krafttraining') as ActivityType;
  let title = String(formData.get('title') || '').trim() || null;
  const planDayId = String(formData.get('planDayId') || '') || null;
  const today = new Date().toISOString().slice(0, 10);

  // A running workout already exists for this user: resume it instead of
  // silently starting a second one (double taps, a stale tab, coming back
  // from a plan day someone already started training from).
  const { data: alreadyRunning } = await supabase.from('workouts').select('id').eq('user_id', user.id).eq('status', 'laeuft').maybeSingle();
  if (alreadyRunning) redirect(`/aktivitaet/training/${alreadyRunning.id}`);

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

  // Race-safe backstop for the check above (two near-simultaneous submits):
  // the unique index on (user_id) where status='laeuft' is the real
  // enforcement, this just turns the resulting conflict into a normal resume
  // instead of a thrown error.
  if (error?.code === '23505') {
    const { data: raceWinner } = await supabase.from('workouts').select('id').eq('user_id', user.id).eq('status', 'laeuft').maybeSingle();
    if (raceWinner) redirect(`/aktivitaet/training/${raceWinner.id}`);
  }
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `replayed` = the very same entry had already been stored (a retry after a lost
 * response, or a double tap): nothing new was written. */
export type AddSetResult = { ok: true; setNumber: number; replayed: boolean } | { ok: false; error: string };

function readNumber(formData: FormData, key: string, min: number, max: number): number | null | 'invalid' {
  const raw = String(formData.get(key) ?? '').trim().replace(',', '.');
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) return 'invalid';
  return value;
}

/** Logs one set / cardio entry. Which fields are accepted depends on the
 * exercise type (looked up server-side, never trusted from the form).
 *
 * `submissionId` is chosen by the client for one entry and becomes the set's id, so
 * sending the same entry again (double tap, retry after a dropped response) can never
 * create a second set: the second insert is recognised by its primary key and
 * answered as already saved. */
export async function addSetAction(formData: FormData): Promise<AddSetResult> {
  const workoutExerciseId = String(formData.get('workoutExerciseId') ?? '');
  const submissionId = String(formData.get('submissionId') ?? '');
  if (!UUID_RE.test(workoutExerciseId) || !UUID_RE.test(submissionId)) return { ok: false, error: 'Ungültige Anfrage. Bitte lade die Seite neu.' };
  await requireAuthUser();
  const supabase = await createClient();

  // The exercise row, its type and the state of its workout come from the database,
  // never from hidden form fields.
  const { data: we } = await supabase
    .from('workout_exercises')
    .select('id, workout_id, exercises(exercise_type), workouts(status)')
    .eq('id', workoutExerciseId)
    .maybeSingle();
  if (!we) return { ok: false, error: 'Diese Übung gibt es in diesem Training nicht mehr. Bitte lade die Seite neu.' };
  const row = we as unknown as { workout_id: string; exercises: { exercise_type: ExerciseType }; workouts: { status: string } | null };
  if (row.workouts?.status !== 'laeuft') return { ok: false, error: 'Dieses Training ist bereits beendet.' };
  const type = normalizeExerciseType(row.exercises.exercise_type);

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
  if (Object.values(fields).includes('invalid')) return { ok: false, error: 'Bitte prüfe deine Eingaben.' };
  const f = fields as Record<keyof typeof fields, number | null>;

  const durationRaw = String(formData.get('duration') || '').trim();
  let duration: number | null = null;
  if (durationRaw) {
    duration = parseDuration(durationRaw);
    if (duration === null || duration > 24 * 3600) return { ok: false, error: 'Zeit bitte als mm:ss oder h:mm:ss eingeben.' };
  }

  const set: Record<string, unknown> = {};
  const metrics: Record<string, number> = {};
  if (f.calories !== null) metrics.calories = f.calories;
  if (f.avgHr !== null) metrics.avg_heart_rate = f.avgHr;
  if (f.maxHr !== null) metrics.max_heart_rate = f.maxHr;

  if (type === 'strength') {
    if (f.reps === null || f.weight === null) return { ok: false, error: 'Gewicht und Wiederholungen sind nötig.' };
    set.weight_kg = f.weight;
    set.reps = f.reps;
    if (f.rpe !== null) metrics.rpe = f.rpe;
    if (f.rest !== null) metrics.rest_seconds = f.rest;
  } else if (type === 'bodyweight') {
    if (f.reps === null && duration === null) return { ok: false, error: 'Wiederholungen oder Dauer angeben.' };
    set.reps = f.reps;
    set.duration_seconds = duration;
    set.weight_kg = f.weight; // optional Zusatzgewicht
    if (f.rpe !== null) metrics.rpe = f.rpe;
  } else if (type === 'cardio_distance') {
    if (duration === null && f.distance === null) return { ok: false, error: 'Zeit oder Distanz angeben.' };
    set.duration_seconds = duration;
    set.distance_km = f.distance;
    if (f.elevation !== null) metrics.elevation_gain_m = f.elevation;
    if (f.incline !== null) metrics.incline_pct = f.incline;
  } else if (type === 'interval') {
    if (f.rounds === null || f.work === null) return { ok: false, error: 'Runden und Belastungszeit angeben.' };
    metrics.rounds = f.rounds;
    metrics.work_seconds = f.work;
    if (f.intervalRest !== null) metrics.interval_rest_seconds = f.intervalRest;
    set.duration_seconds = duration ?? f.rounds * (f.work + (f.intervalRest ?? 0));
  } else {
    // cardio_time, mobility, sport, other
    if (duration === null) return { ok: false, error: 'Bitte eine Dauer angeben.' };
    set.duration_seconds = duration;
  }

  const notes = String(formData.get('notes') || '').trim().slice(0, 500) || null;

  const { count } = await supabase
    .from('workout_sets')
    .select('id', { count: 'exact', head: true })
    .eq('workout_exercise_id', workoutExerciseId);
  const setNumber = (count ?? 0) + 1;

  const { error } = await supabase.from('workout_sets').insert({
    id: submissionId,
    workout_exercise_id: workoutExerciseId,
    set_number: setNumber,
    metrics,
    notes,
    ...set,
  });
  if (error) {
    if (error.code === '23505') {
      // This entry was already stored — answer with the stored one instead of writing it twice.
      const { data: existing } = await supabase.from('workout_sets').select('set_number, workout_exercise_id').eq('id', submissionId).maybeSingle();
      if (existing && existing.workout_exercise_id === workoutExerciseId) {
        revalidatePath(`/aktivitaet/training/${row.workout_id}`);
        return { ok: true, setNumber: existing.set_number, replayed: true };
      }
    }
    if (error.code === '23503') return { ok: false, error: 'Diese Übung gibt es in diesem Training nicht mehr. Bitte lade die Seite neu.' };
    return { ok: false, error: 'Eintrag konnte nicht gespeichert werden.' };
  }

  revalidatePath(`/aktivitaet/training/${row.workout_id}`);
  return { ok: true, setNumber, replayed: false };
}

export async function deleteSetAction(setId: string, workoutId: string) {
  'use server';
  await requireAuthUser();
  const supabase = await createClient();
  await supabase.from('workout_sets').delete().eq('id', setId);
  revalidatePath(`/aktivitaet/training/${workoutId}`);
}

/** Freezes the running timer (pauses it) and sends the user to the review
 * screen. Because the workout is now paused, the elapsed time it shows stays
 * frozen no matter how long the review takes — reviewing never adds to
 * training time. Backing out of the review without saving just leaves the
 * workout paused, resumable from the running-workout strip or this page. */
export async function startReviewAction(workoutId: string) {
  'use server';
  await requireAuthUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc('pause_own_workout', { p_workout_id: workoutId });
  if (error) throw new Error('Training konnte nicht angehalten werden.');
  redirect(`/aktivitaet/training/${workoutId}/beenden`);
}

export async function pauseWorkoutAction(workoutId: string) {
  'use server';
  await requireAuthUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc('pause_own_workout', { p_workout_id: workoutId });
  if (error) throw new Error('Pause konnte nicht gespeichert werden.');
  revalidatePath(`/aktivitaet/training/${workoutId}`);
  // The running-workout strip lives in the shared app-shell layout, not this
  // route — its paused_at prop needs the layout itself to refresh too.
  revalidatePath('/', 'layout');
}

export async function resumeWorkoutAction(workoutId: string) {
  'use server';
  await requireAuthUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc('resume_own_workout', { p_workout_id: workoutId });
  if (error) throw new Error('Training konnte nicht fortgesetzt werden.');
  revalidatePath(`/aktivitaet/training/${workoutId}`);
  revalidatePath('/', 'layout');
}

export type FinishWorkoutState = { error?: string; confirmRequired?: boolean } | undefined;

/** Saves the reviewed, possibly-corrected duration/end time through the
 * validated finish_own_workout RPC — never a raw update. The server
 * independently re-enforces the >=180min confirmation requirement regardless
 * of what the review screen already showed. */
export async function finishWorkoutAction(_prev: FinishWorkoutState, formData: FormData): Promise<FinishWorkoutState> {
  const workoutId = String(formData.get('workoutId') || '');
  const user = await requireAuthUser();
  const supabase = await createClient();

  const { data: workout } = await supabase.from('workouts').select('paused_at').eq('id', workoutId).eq('user_id', user.id).maybeSingle();
  if (!workout) return { error: 'Training nicht gefunden.' };

  const durationSeconds = parseDuration(String(formData.get('duration') || ''));
  if (!durationSeconds || durationSeconds < 1 || durationSeconds > 24 * 3600) {
    return { error: 'Dauer bitte als mm:ss oder h:mm:ss eingeben.' };
  }

  const referenceTime = workout.paused_at ? new Date(workout.paused_at) : new Date();
  const timeRaw = String(formData.get('finishedAtTime') || '').trim();
  const finishedAt = timeRaw ? setLocalTimeOfDay(referenceTime, timeRaw) : referenceTime;
  if (!finishedAt) return { error: 'Bitte eine gültige Uhrzeit angeben.' };

  const distanceRaw = String(formData.get('distanceKm') || '').trim();
  const distanceKm = distanceRaw ? Number(distanceRaw) : null;
  const notes = String(formData.get('notes') || '').trim() || null;
  const confirmLong = formData.get('confirmLong') === 'true';

  const { error } = await supabase.rpc('finish_own_workout', {
    p_workout_id: workoutId,
    p_finished_at: finishedAt.toISOString(),
    p_duration_seconds: durationSeconds,
    p_distance_km: distanceKm,
    p_notes: notes,
    p_confirm_long: confirmLong,
  });

  if (error) {
    if (error.message?.includes('confirmation_required')) return { confirmRequired: true };
    return { error: 'Training konnte nicht gespeichert werden.' };
  }

  revalidatePath('/aktivitaet');
  revalidatePath('/team');
  revalidatePath('/team/chat');
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

export type EditWorkoutState = { error?: string; confirmRequired?: boolean } | undefined;

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
    .select('id, user_id, team_id, status, finished_at')
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
    p_confirm_long: formData.get('confirmLong') === 'true',
  });
  if (error) {
    if (error.message?.includes('confirmation_required')) return { confirmRequired: true };
    return { error: 'Training konnte nicht gespeichert werden.' };
  }

  await refreshAffectedRecaps(workout.team_id, [new Date(workout.finished_at), finishedAt]);

  revalidatePath('/aktivitaet');
  revalidatePath('/team');
  redirect(`/aktivitaet/training/${workoutId}/zusammenfassung`);
}

/** Deletes the caller's own workout together with everything derived from it
 * (see delete_own_workout): team events with their reactions/replies, feed
 * entries, score effects, challenge progress. */
export async function deleteWorkoutAction(workoutId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(workoutId)) return;
  const user = await requireAuthUser();
  const supabase = await createClient();

  const { data: workout } = await supabase
    .from('workouts')
    .select('team_id, finished_at')
    .eq('id', workoutId)
    .eq('user_id', user.id)
    .maybeSingle();

  const { error } = await supabase.rpc('delete_own_workout', { p_workout_id: workoutId });
  if (error) throw new Error('Training konnte nicht gelöscht werden.');

  if (workout?.finished_at) await refreshAffectedRecaps(workout.team_id, [new Date(workout.finished_at)]);

  revalidatePath('/aktivitaet');
  revalidatePath('/team');
  revalidatePath('/team/chat');
  redirect('/aktivitaet');
}
