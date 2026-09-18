'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireTeamAdminMembership } from '@/lib/data/admin';
import { generateInviteToken } from '@/lib/invite-token';
import { appConfig } from '@/lib/config';
import { buildInviteEmail, isEmailConfigured, sendEmail } from '@/lib/server/email';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type SendInviteEmailState = { success?: string; error?: string } | undefined;

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

/** Admin-only: creates a normal single-use invite (same secure token, expiry,
 * revocation and redeem_team_invite() as QR/link invites) and mails its link.
 * Membership is never granted here — the recipient still has to open the
 * link, sign in/register and confirm. */
export async function sendInviteEmailAction(_prev: SendInviteEmailState, formData: FormData): Promise<SendInviteEmailState> {
  const admin = await requireTeamAdminMembership();
  const supabase = await createClient();

  const email = String(formData.get('email') || '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return { error: 'Bitte eine gültige E-Mail-Adresse eingeben.' };
  if (!isEmailConfigured()) return { error: 'Der E-Mail-Versand ist noch nicht eingerichtet.' };

  const { token, tokenHash } = generateInviteToken();
  const { data: invite, error: inviteError } = await supabase
    .from('team_invites')
    .insert({
      team_id: admin.team_id,
      token_hash: tokenHash,
      created_by: admin.user_id,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      max_uses: 1,
    })
    .select('id')
    .single();
  if (inviteError || !invite) return { error: 'Einladung konnte nicht gesendet werden.' };

  const revoke = () =>
    supabase.from('team_invites').update({ revoked_at: new Date().toISOString() }).eq('id', invite.id).eq('team_id', admin.team_id);

  // Insert the log row FIRST: its DB trigger is the rate-limit gate, so a
  // throttled admin never reaches the mail provider.
  const { data: logRow, error: logError } = await supabase
    .from('team_invite_emails')
    .insert({ team_id: admin.team_id, invite_id: invite.id, invited_by: admin.user_id, email, status: 'sent' })
    .select('id')
    .single();
  if (logError || !logRow) {
    await revoke();
    const limited = logError?.message?.includes('invite_rate_limited');
    return { error: limited ? 'Zu viele Einladungen in kurzer Zeit. Bitte warte einen Moment.' : 'Einladung konnte nicht gesendet werden.' };
  }

  const mail = buildInviteEmail(admin.team_name, `${appConfig.url}/beitreten/${token}`);
  const sent = await sendEmail({ to: email, ...mail });

  await supabase.from('audit_events').insert([
    { team_id: admin.team_id, actor_user_id: admin.user_id, action: 'invite_created', entity_type: 'team_invite', entity_id: invite.id },
    {
      team_id: admin.team_id,
      actor_user_id: admin.user_id,
      action: sent ? 'invite_email_sent' : 'invite_email_failed',
      entity_type: 'team_invite',
      entity_id: invite.id,
    },
  ]);

  if (!sent) {
    await supabase.from('team_invite_emails').update({ status: 'failed' }).eq('id', logRow.id);
    await revoke();
    revalidatePath('/team/verwalten/einladungen');
    return { error: 'Einladung konnte nicht gesendet werden.' };
  }

  revalidatePath('/team/verwalten/einladungen');
  return { success: 'Einladung wurde gesendet.' };
}
