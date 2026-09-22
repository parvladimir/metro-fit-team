'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAuthUser } from '@/lib/data/profile';
import { getOrCreateActivePlan, getPlanDay } from '@/lib/data/plan';
import { parseTargets, targetsToColumns } from '@/lib/plan-targets';
import { defaultTemplateName, sanitizeTemplateName } from '@/lib/plan-templates';

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
  // Targets are optional and parsed per the exercise's real type (read from the
  // DB under RLS), so a crafted request cannot store irrelevant fields.
  const { data: exercise } = await supabase.from('exercises').select('exercise_type').eq('id', exerciseId).maybeSingle();
  if (!exercise) return;
  const targets = parseTargets(exercise.exercise_type, formData);
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
    ...targetsToColumns(targets),
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

// ---------------------------------------------------------------------------
// Plan templates: reusable, named snapshots of one day's exercises + planned
// targets. A template never links back to the day it was made from or to any
// day created from it, so all three stay independently editable.
// ---------------------------------------------------------------------------

export interface TemplateActionResult {
  ok: boolean;
  error?: string;
  skipped?: number;
}

export async function saveAsTemplateAction(weekday: number, name: string): Promise<TemplateActionResult> {
  'use server';
  const user = await requireAuthUser();
  const supabase = await createClient();
  const plan = await getOrCreateActivePlan(user.id);
  const day = await getPlanDay(plan.id, weekday);
  if (!day) return { ok: false, error: 'Für diesen Tag gibt es noch keinen Plan.' };

  const cleanName = sanitizeTemplateName(name) || defaultTemplateName(day.exercises.map((pe) => pe.exercise.muscle_group));

  const { data: template, error: templateError } = await supabase
    .from('plan_templates')
    .insert({ user_id: user.id, name: cleanName })
    .select('id')
    .single();
  if (templateError || !template) return { ok: false, error: 'Vorlage konnte nicht gespeichert werden.' };

  if (day.exercises.length > 0) {
    const { error: itemsError } = await supabase.from('plan_template_items').insert(
      day.exercises.map((pe, i) => ({
        template_id: template.id,
        exercise_id: pe.exercise_id,
        exercise_name: pe.exercise.name,
        position: i,
        target_sets: pe.target_sets,
        target_reps: pe.target_reps,
        target_weight_kg: pe.target_weight_kg,
        target_duration_seconds: pe.target_duration_seconds,
        target_distance_km: pe.target_distance_km,
        target_metrics: pe.target_metrics,
      })),
    );
    if (itemsError) {
      await supabase.from('plan_templates').delete().eq('id', template.id);
      return { ok: false, error: 'Vorlage konnte nicht gespeichert werden.' };
    }
  }

  revalidatePath('/plan');
  return { ok: true };
}

export async function createDayFromTemplateAction(templateId: string, weekday: number): Promise<TemplateActionResult> {
  'use server';
  const user = await requireAuthUser();
  const supabase = await createClient();
  const plan = await getOrCreateActivePlan(user.id);

  const { data: template } = await supabase
    .from('plan_templates')
    .select('id, name, user_id')
    .eq('id', templateId)
    .maybeSingle();
  if (!template || template.user_id !== user.id) return { ok: false, error: 'Vorlage nicht gefunden.' };

  const { data: items } = await supabase
    .from('plan_template_items')
    .select('exercise_id, target_sets, target_reps, target_weight_kg, target_duration_seconds, target_distance_km, target_metrics')
    .eq('template_id', templateId)
    .order('position', { ascending: true });

  // Items whose exercise was since deleted are skipped rather than failing
  // the whole apply — the template itself keeps its snapshot untouched.
  const usable = (items ?? []).filter((it) => it.exercise_id != null);
  const skipped = (items?.length ?? 0) - usable.length;

  const { data: day, error: dayError } = await supabase
    .from('workout_plan_days')
    .upsert({ plan_id: plan.id, weekday, title: template.name }, { onConflict: 'plan_id,weekday' })
    .select('id')
    .single();
  if (dayError || !day) return { ok: false, error: 'Tag konnte nicht erstellt werden.' };

  // "Aus Vorlage erstellen" replaces this day's exercises with an independent
  // copy of the template's — it never edits the template or other days.
  await supabase.from('workout_plan_exercises').delete().eq('plan_day_id', day.id);

  if (usable.length > 0) {
    const { error: insertError } = await supabase.from('workout_plan_exercises').insert(
      usable.map((it, i) => ({
        plan_day_id: day.id,
        exercise_id: it.exercise_id,
        position: i,
        target_sets: it.target_sets,
        target_reps: it.target_reps,
        target_weight_kg: it.target_weight_kg,
        target_duration_seconds: it.target_duration_seconds,
        target_distance_km: it.target_distance_km,
        target_metrics: it.target_metrics,
      })),
    );
    if (insertError) return { ok: false, error: 'Übungen konnten nicht übernommen werden.' };
  }

  await supabase.from('plan_templates').update({ last_used_at: new Date().toISOString() }).eq('id', templateId);

  revalidatePath('/plan');
  revalidatePath(`/plan/tag/${weekday}`);
  return { ok: true, skipped };
}

export async function renameTemplateAction(templateId: string, name: string): Promise<TemplateActionResult> {
  'use server';
  const user = await requireAuthUser();
  const supabase = await createClient();
  const cleanName = sanitizeTemplateName(name);
  if (!cleanName) return { ok: false, error: 'Bitte einen Namen eingeben.' };

  const { error } = await supabase.from('plan_templates').update({ name: cleanName }).eq('id', templateId).eq('user_id', user.id);
  if (error) return { ok: false, error: 'Vorlage konnte nicht umbenannt werden.' };

  revalidatePath('/plan');
  return { ok: true };
}

export async function duplicateTemplateAction(templateId: string): Promise<TemplateActionResult> {
  'use server';
  const user = await requireAuthUser();
  const supabase = await createClient();

  const { data: source } = await supabase.from('plan_templates').select('id, name, user_id').eq('id', templateId).maybeSingle();
  if (!source || source.user_id !== user.id) return { ok: false, error: 'Vorlage nicht gefunden.' };

  const { data: items } = await supabase
    .from('plan_template_items')
    .select('exercise_id, exercise_name, position, target_sets, target_reps, target_weight_kg, target_duration_seconds, target_distance_km, target_metrics')
    .eq('template_id', templateId)
    .order('position', { ascending: true });

  const { data: copy, error: copyError } = await supabase
    .from('plan_templates')
    .insert({ user_id: user.id, name: sanitizeTemplateName(`${source.name} (Kopie)`) })
    .select('id')
    .single();
  if (copyError || !copy) return { ok: false, error: 'Vorlage konnte nicht dupliziert werden.' };

  if (items && items.length > 0) {
    const { error: itemsError } = await supabase.from('plan_template_items').insert(
      items.map((it) => ({ ...it, template_id: copy.id })),
    );
    if (itemsError) {
      await supabase.from('plan_templates').delete().eq('id', copy.id);
      return { ok: false, error: 'Vorlage konnte nicht dupliziert werden.' };
    }
  }

  revalidatePath('/plan');
  return { ok: true };
}

export async function deleteTemplateAction(templateId: string): Promise<TemplateActionResult> {
  'use server';
  await requireAuthUser();
  const supabase = await createClient();
  const { error } = await supabase.from('plan_templates').delete().eq('id', templateId);
  if (error) return { ok: false, error: 'Vorlage konnte nicht gelöscht werden.' };

  revalidatePath('/plan');
  return { ok: true };
}

export async function removeDeadTemplateItemsAction(templateId: string): Promise<TemplateActionResult> {
  'use server';
  const user = await requireAuthUser();
  const supabase = await createClient();
  const { data: template } = await supabase.from('plan_templates').select('user_id').eq('id', templateId).maybeSingle();
  if (!template || template.user_id !== user.id) return { ok: false, error: 'Vorlage nicht gefunden.' };

  const { error } = await supabase.from('plan_template_items').delete().eq('template_id', templateId).is('exercise_id', null);
  if (error) return { ok: false, error: 'Konnte nicht bereinigt werden.' };

  revalidatePath('/plan');
  return { ok: true };
}
