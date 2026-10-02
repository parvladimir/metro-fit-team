'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAuthUser, getPrimaryTeamMembership } from '@/lib/data/profile';

export async function createMissionAction(formData: FormData) {
  const user = await requireAuthUser();
  const membership = await getPrimaryTeamMembership(user.id);
  if (!membership || membership.role !== 'team_admin') throw new Error('Nur Team-Admins können eine Wochenmission erstellen.');

  const supabase = await createClient();
  const { error } = await supabase.from('team_missions').insert({
    team_id: membership.team_id,
    title: String(formData.get('title') || '').trim(),
    target_days: Number(formData.get('targetDays')),
    starts_at: String(formData.get('startsAt')),
    ends_at: String(formData.get('endsAt')),
    created_by: user.id,
  });

  if (error) throw new Error('Wochenmission konnte nicht erstellt werden.');

  revalidatePath('/team/mission');
  revalidatePath('/');
  redirect('/team/mission');
}

/** Idempotent: a mission already cancelled is left as-is on a repeat call. */
export async function cancelMissionAction(missionId: string) {
  const user = await requireAuthUser();
  const membership = await getPrimaryTeamMembership(user.id);
  if (!membership || membership.role !== 'team_admin') throw new Error('Nur Team-Admins können eine Wochenmission abbrechen.');

  const supabase = await createClient();
  await supabase.from('team_missions').update({ cancelled_at: new Date().toISOString() }).eq('id', missionId).is('cancelled_at', null);

  revalidatePath('/team/mission');
  revalidatePath('/');
}
