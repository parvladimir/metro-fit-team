'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireTeamAdminMembership } from '@/lib/data/admin';
import { generateInviteToken } from '@/lib/invite-token';
import { appConfig } from '@/lib/config';

export type CreateInviteState = { token?: string; link?: string; error?: string } | undefined;

export async function createInviteAction(_prev: CreateInviteState, formData: FormData): Promise<CreateInviteState> {
  const admin = await requireTeamAdminMembership();
  const supabase = await createClient();

  const expiresInDays = Number(formData.get('expiresInDays') || 7);
  const maxUsesRaw = String(formData.get('maxUses') || '').trim();
  const maxUses = maxUsesRaw ? Number(maxUsesRaw) : null;

  const { token, tokenHash } = generateInviteToken();
  const expiresAt = expiresInDays > 0 ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString() : null;

  const { error } = await supabase.from('team_invites').insert({
    team_id: admin.team_id,
    token_hash: tokenHash,
    created_by: admin.user_id,
    expires_at: expiresAt,
    max_uses: maxUses,
  });

  if (error) return { error: 'Einladung konnte nicht erstellt werden.' };

  await supabase.from('audit_events').insert({
    team_id: admin.team_id,
    actor_user_id: admin.user_id,
    action: 'invite_created',
    entity_type: 'team_invite',
  });

  revalidatePath('/team/verwalten/einladungen');
  return { token, link: `${appConfig.url}/beitreten/${token}` };
}

export async function revokeInviteAction(inviteId: string) {
  'use server';
  const admin = await requireTeamAdminMembership();
  const supabase = await createClient();

  await supabase.from('team_invites').update({ revoked_at: new Date().toISOString() }).eq('id', inviteId).eq('team_id', admin.team_id);

  await supabase.from('audit_events').insert({
    team_id: admin.team_id,
    actor_user_id: admin.user_id,
    action: 'invite_revoked',
    entity_type: 'team_invite',
    entity_id: inviteId,
  });

  revalidatePath('/team/verwalten/einladungen');
}
