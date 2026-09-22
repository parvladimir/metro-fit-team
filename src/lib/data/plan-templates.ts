import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Exercise, PlanTemplate, PlanTemplateItem } from '@/types/database';

export interface PlanTemplateItemWithExercise extends PlanTemplateItem {
  exercise: Exercise | null; // null once the referenced exercise has been deleted
}

export interface PlanTemplateWithItems extends PlanTemplate {
  items: PlanTemplateItemWithExercise[];
}

function withItems(
  row: PlanTemplate & { plan_template_items: (PlanTemplateItem & { exercises: Exercise | null })[] },
): PlanTemplateWithItems {
  return {
    ...row,
    items: (row.plan_template_items ?? [])
      .map((it) => ({ ...it, exercise: it.exercises }))
      .sort((a, b) => a.position - b.position),
  };
}

export async function getTemplates(userId: string): Promise<PlanTemplateWithItems[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('plan_templates')
    .select('*, plan_template_items(*, exercises(*))')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  return (data ?? []).map((row) =>
    withItems(row as unknown as PlanTemplate & { plan_template_items: (PlanTemplateItem & { exercises: Exercise | null })[] }),
  );
}

export async function getTemplate(templateId: string): Promise<PlanTemplateWithItems | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('plan_templates')
    .select('*, plan_template_items(*, exercises(*))')
    .eq('id', templateId)
    .maybeSingle();

  if (!data) return null;
  return withItems(data as unknown as PlanTemplate & { plan_template_items: (PlanTemplateItem & { exercises: Exercise | null })[] });
}
