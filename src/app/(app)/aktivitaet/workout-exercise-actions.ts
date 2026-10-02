'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAuthUser } from '@/lib/data/profile';
import { getExerciseHistory } from '@/lib/data/exercise-history';
import type { HistoryEntry } from '@/lib/exercise-history';

/**
 * Changes to the exercise list of the workout that is running right now.
 *
 * These only ever call the owner-scoped database functions from migration 0049
 * (replace_workout_exercise, postpone_workout_exercise): ownership, "the workout is
 * still running", "the replacement is an exercise this user may use" and atomicity
 * are enforced there, never by a hidden form field. Nothing here touches the weekly
 * plan, a saved template, the points ledger, the timer or the team feed.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorText(message: string | undefined, code: string | undefined): string {
  if (code === 'PGRST202' || code === '42883') return 'Diese Funktion ist noch nicht verfügbar.';
  const m = message ?? '';
  if (m.includes('exercise_not_found')) return 'Diese Übung gibt es in diesem Training nicht mehr. Bitte lade die Seite neu.';
  if (m.includes('workout_not_active')) return 'Dieses Training ist bereits beendet.';
  if (m.includes('exercise_not_accessible')) return 'Diese Übung ist für dich nicht verfügbar.';
  if (m.includes('same_exercise')) return 'Das ist bereits die aktuelle Übung.';
  if (m.includes('invalid_request')) return 'Die Anfrage konnte nicht verarbeitet werden. Bitte versuche es erneut.';
  return '';
}

export type ReplaceExerciseResult =
  | {
      ok: true;
      /** 'replaced': the original is gone. 'added': it had sets and stays; the replacement follows it. */
      mode: 'replaced' | 'added';
      newWorkoutExerciseId: string;
      removedWorkoutExerciseId: string | null;
      replayed: boolean;
    }
  | { ok: false; error: string };

/** `requestId` becomes the id of the new exercise row, so a retried or double-sent request is
 * answered as already done instead of being applied twice. */
export async function replaceExerciseAction(input: {
  workoutId: string;
  workoutExerciseId: string;
  newExerciseId: string;
  requestId: string;
}): Promise<ReplaceExerciseResult> {
  const { workoutId, workoutExerciseId, newExerciseId, requestId } = input;
  if (![workoutId, workoutExerciseId, newExerciseId, requestId].every((v) => UUID_RE.test(String(v)))) {
    return { ok: false, error: 'Ungültige Anfrage. Bitte lade die Seite neu.' };
  }
  await requireAuthUser();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('replace_workout_exercise', {
    p_workout_exercise_id: workoutExerciseId,
    p_new_exercise_id: newExerciseId,
    p_new_workout_exercise_id: requestId,
  });
  if (error) return { ok: false, error: errorText(error.message, error.code) || 'Übung konnte nicht ersetzt werden.' };

  const row = (data as Array<{ out_mode: string; out_workout_exercise_id: string; out_removed_workout_exercise_id: string | null; out_replayed: boolean }> | null)?.[0];
  if (!row) return { ok: false, error: 'Übung konnte nicht ersetzt werden.' };

  revalidatePath(`/aktivitaet/training/${workoutId}`);
  return {
    ok: true,
    mode: row.out_mode === 'added' ? 'added' : 'replaced',
    newWorkoutExerciseId: row.out_workout_exercise_id,
    removedWorkoutExerciseId: row.out_removed_workout_exercise_id,
    replayed: row.out_replayed === true,
  };
}

export type PostponeExerciseResult = { ok: true; changed: boolean } | { ok: false; error: string };

export async function postponeExerciseAction(input: { workoutId: string; workoutExerciseId: string }): Promise<PostponeExerciseResult> {
  const { workoutId, workoutExerciseId } = input;
  if (![workoutId, workoutExerciseId].every((v) => UUID_RE.test(String(v)))) return { ok: false, error: 'Ungültige Anfrage. Bitte lade die Seite neu.' };
  await requireAuthUser();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('postpone_workout_exercise', { p_workout_exercise_id: workoutExerciseId });
  if (error) return { ok: false, error: errorText(error.message, error.code) || 'Übung konnte nicht verschoben werden.' };

  revalidatePath(`/aktivitaet/training/${workoutId}`);
  return { ok: true, changed: (data as Array<{ out_changed: boolean }> | null)?.[0]?.out_changed === true };
}

export type ExerciseHistoryResult = { ok: true; entries: HistoryEntry[]; hasMore: boolean } | { ok: false; error: string };

/** One page of the user's own earlier sessions of an exercise ("Verlauf"), loaded only when the sheet is opened. */
export async function loadExerciseHistoryAction(input: { exerciseId: string; excludeWorkoutId: string; before?: string | null }): Promise<ExerciseHistoryResult> {
  const { exerciseId, excludeWorkoutId } = input;
  const before = input.before && !Number.isNaN(Date.parse(input.before)) ? new Date(input.before).toISOString() : null;
  if (![exerciseId, excludeWorkoutId].every((v) => UUID_RE.test(String(v)))) return { ok: false, error: 'Ungültige Anfrage.' };
  await requireAuthUser();

  const page = await getExerciseHistory(exerciseId, excludeWorkoutId, before);
  if (page.status === 'ok') return { ok: true, entries: page.entries, hasMore: page.hasMore };
  return { ok: false, error: page.status === 'unavailable' ? 'Diese Funktion ist noch nicht verfügbar.' : 'Der Verlauf konnte nicht geladen werden.' };
}
