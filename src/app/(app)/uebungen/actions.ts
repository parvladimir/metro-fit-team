'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAuthUser } from '@/lib/data/profile';
import { EXERCISE_TYPE_OPTIONS, MUSCLE_GROUP_OPTIONS, usesSetTargets } from '@/lib/exercise-types';
import type { ExerciseType, MuscleGroup } from '@/types/database';

export type CreateExerciseState = { error?: string } | undefined;

/** Only same-app plan/workout paths — never an arbitrary redirect target. */
function safeReturnTo(raw: string): string {
  return /^\/(plan|aktivitaet)\/[A-Za-z0-9/_-]*$/.test(raw) ? raw : '/plan';
}

export async function createExerciseAction(_prev: CreateExerciseState, formData: FormData): Promise<CreateExerciseState> {
  const user = await requireAuthUser();
  const supabase = await createClient();

  const name = String(formData.get('name') || '').trim();
  const type = String(formData.get('exerciseType') || '') as ExerciseType;
  const muscleRaw = String(formData.get('muscleGroup') || 'other') as MuscleGroup;
  const equipment = String(formData.get('equipment') || '').trim().slice(0, 80) || null;
  const notes = String(formData.get('notes') || '').trim().slice(0, 500) || null;
  const returnTo = safeReturnTo(String(formData.get('returnTo') || ''));

  if (name.length < 2 || name.length > 80) return { error: 'Der Name muss zwischen 2 und 80 Zeichen lang sein.' };
  if (!EXERCISE_TYPE_OPTIONS.some((o) => o.value === type)) return { error: 'Bitte eine Kategorie wählen.' };
  const muscle: MuscleGroup = MUSCLE_GROUP_OPTIONS.some((o) => o.value === muscleRaw) ? muscleRaw : 'other';

  const { data: existing } = await supabase
    .from('exercises')
    .select('id')
    .eq('owner_user_id', user.id)
    .ilike('name', name)
    .maybeSingle();
  if (existing) return { error: 'Du hast bereits eine Übung mit diesem Namen.' };

  const setBased = usesSetTargets(type);
  const { data, error } = await supabase
    .from('exercises')
    .insert({
      name,
      exercise_type: type,
      muscle_group: muscle,
      equipment,
      notes,
      is_custom: true,
      visibility: 'private',
      owner_user_id: user.id,
      created_by: user.id,
      team_id: null,
      default_sets: setBased ? 3 : null,
      default_reps: setBased ? 10 : null,
    })
    .select('id')
    .single();

  if (error || !data) return { error: 'Übung konnte nicht gespeichert werden.' };

  const sep = returnTo.includes('?') ? '&' : '?';
  redirect(`${returnTo}${sep}neu=${data.id}`);
}
