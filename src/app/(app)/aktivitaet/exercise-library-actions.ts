'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAuthUser } from '@/lib/data/profile';
import { isMissingObject } from '@/lib/data/exercise-library';

/**
 * Personal favourites and "add an exercise to the running workout".
 *
 * Favourites are a private bookmark list: only the caller's own rows, and only for an exercise the
 * caller may see (both enforced by RLS, not by the client). Adding an exercise to a workout checks on
 * the server that the workout is the caller's running one and that the exercise is one they may use —
 * a foreign key alone would accept someone else's private exercise.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SetFavoriteResult = { ok: true } | { ok: false; error: string };

export async function setExerciseFavoriteAction(input: { exerciseId: string; favorite: boolean }): Promise<SetFavoriteResult> {
  const { exerciseId, favorite } = input;
  if (!UUID_RE.test(String(exerciseId))) return { ok: false, error: 'Ungültige Anfrage.' };
  const user = await requireAuthUser();
  const supabase = await createClient();

  if (favorite) {
    // "Already a favourite" is a success, not an error (a double tap, a second device).
    const { error } = await supabase
      .from('exercise_favorites')
      .upsert({ user_id: user.id, exercise_id: exerciseId }, { onConflict: 'user_id,exercise_id', ignoreDuplicates: true });
    if (error) {
      if (isMissingObject(error)) return { ok: false, error: 'Diese Funktion ist noch nicht verfügbar.' };
      if (error.message?.includes('favorite_limit_reached')) return { ok: false, error: 'Du hast die maximale Anzahl an Favoriten erreicht.' };
      if (error.code === '42501' || error.code === '23503') return { ok: false, error: 'Diese Übung ist für dich nicht verfügbar.' };
      return { ok: false, error: 'Favorit konnte nicht gespeichert werden.' };
    }
    return { ok: true };
  }

  const { error } = await supabase.from('exercise_favorites').delete().eq('user_id', user.id).eq('exercise_id', exerciseId);
  if (error) {
    if (isMissingObject(error)) return { ok: false, error: 'Diese Funktion ist noch nicht verfügbar.' };
    return { ok: false, error: 'Favorit konnte nicht entfernt werden.' };
  }
  return { ok: true };
}

export type AddExerciseResult = { ok: true; workoutExerciseId: string; replayed: boolean } | { ok: false; error: string };

/** Appends an exercise to the END of the caller's running workout. `requestId` becomes the id of the new
 * row, so a double tap or a retry after a lost response cannot add it twice. */
export async function addExerciseToWorkoutAction(input: { workoutId: string; exerciseId: string; requestId: string }): Promise<AddExerciseResult> {
  const { workoutId, exerciseId, requestId } = input;
  if (![workoutId, exerciseId, requestId].every((v) => UUID_RE.test(String(v)))) return { ok: false, error: 'Ungültige Anfrage. Bitte lade die Seite neu.' };
  await requireAuthUser();
  const supabase = await createClient();

  // RLS: only the caller's own workout and only exercises the caller may see come back.
  const [{ data: workout }, { data: exercise }] = await Promise.all([
    supabase.from('workouts').select('status').eq('id', workoutId).maybeSingle(),
    supabase.from('exercises').select('id').eq('id', exerciseId).maybeSingle(),
  ]);
  if (!workout) return { ok: false, error: 'Dieses Training gibt es nicht mehr. Bitte lade die Seite neu.' };
  if (workout.status !== 'laeuft') return { ok: false, error: 'Dieses Training ist bereits beendet.' };
  if (!exercise) return { ok: false, error: 'Diese Übung ist für dich nicht verfügbar.' };

  const { data: last } = await supabase.from('workout_exercises').select('position').eq('workout_id', workoutId).order('position', { ascending: false }).limit(1);
  const position = (last?.[0]?.position ?? -1) + 1;

  const { error } = await supabase.from('workout_exercises').insert({ id: requestId, workout_id: workoutId, exercise_id: exerciseId, position });
  if (error) {
    if (error.code === '23505') {
      const { data: existing } = await supabase.from('workout_exercises').select('workout_id, exercise_id').eq('id', requestId).maybeSingle();
      if (existing && existing.workout_id === workoutId && existing.exercise_id === exerciseId) {
        revalidatePath(`/aktivitaet/training/${workoutId}`);
        return { ok: true, workoutExerciseId: requestId, replayed: true };
      }
    }
    return { ok: false, error: 'Übung konnte nicht hinzugefügt werden.' };
  }

  revalidatePath(`/aktivitaet/training/${workoutId}`);
  return { ok: true, workoutExerciseId: requestId, replayed: false };
}
