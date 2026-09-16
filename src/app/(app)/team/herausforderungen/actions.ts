'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAuthUser, getPrimaryTeamMembership } from '@/lib/data/profile';
import type { ChallengeMetric, ChallengeType } from '@/types/database';

export async function createChallengeAction(formData: FormData) {
  const user = await requireAuthUser();
  const membership = await getPrimaryTeamMembership(user.id);
  if (!membership || membership.role !== 'team_admin') throw new Error('Nur Team-Admins können Herausforderungen erstellen.');

  const supabase = await createClient();

  const { data: challenge, error } = await supabase
    .from('challenges')
    .insert({
      team_id: membership.team_id,
      title: String(formData.get('title') || '').trim(),
      description: String(formData.get('description') || '').trim() || null,
      challenge_type: String(formData.get('challengeType')) as ChallengeType,
      metric: String(formData.get('metric')) as ChallengeMetric,
      target_value: Number(formData.get('targetValue')),
      starts_at: String(formData.get('startsAt')),
      ends_at: String(formData.get('endsAt')),
      points_reward: Number(formData.get('pointsReward') || 100),
      created_by: user.id,
    })
    .select('id')
    .single();

  if (error || !challenge) throw new Error('Herausforderung konnte nicht erstellt werden.');

  await supabase.from('audit_events').insert({
    team_id: membership.team_id,
    actor_user_id: user.id,
    action: 'challenge_created',
    entity_type: 'challenge',
    entity_id: challenge.id,
  });

  revalidatePath('/team/herausforderungen');
  redirect('/team/herausforderungen');
}

/** Members opt in to an individual challenge to start tracking their progress. */
export async function joinChallengeAction(challengeId: string) {
  'use server';
  const user = await requireAuthUser();
  const supabase = await createClient();
  await supabase
    .from('challenge_participants')
    .upsert({ challenge_id: challengeId, user_id: user.id, progress_value: 0 }, { onConflict: 'challenge_id,user_id', ignoreDuplicates: true });
  revalidatePath('/team/herausforderungen');
}
