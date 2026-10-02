'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { waitUntil } from '@vercel/functions';
import { createClient } from '@/lib/supabase/server';
import { requireAuthUser, getPrimaryTeamMembership } from '@/lib/data/profile';
import { duelErrorText, validateDuelInput } from '@/lib/duels';
import { notifyDuelAccepted, notifyDuelInvitation } from '@/lib/server/push';

export interface ProposeDuelState {
  error?: string;
}

function refresh() {
  revalidatePath('/team/duelle');
  revalidatePath('/');
}

/** Sends a duel invitation. The rules (one open duel per person, the start
 * window, who may be invited) live in the database; the checks here only give
 * a precise message early. The invitee is notified only when this call really
 * created the invitation — an identical retry returns the existing one. */
export async function proposeDuelAction(_prev: ProposeDuelState | undefined, formData: FormData): Promise<ProposeDuelState> {
  const user = await requireAuthUser();
  const membership = await getPrimaryTeamMembership(user.id);
  if (!membership) return { error: duelErrorText('not_a_team_member') };

  const parsed = validateDuelInput({
    inviteeId: formData.get('inviteeId'),
    targetDays: formData.get('targetDays'),
    startsOn: formData.get('startsOn'),
  });
  if (!parsed.ok) return { error: duelErrorText(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('propose_team_duel', {
    p_team_id: membership.team_id,
    p_invitee_id: parsed.value.inviteeId,
    p_target_days: parsed.value.targetDays,
    p_starts_on: parsed.value.startsOn,
  });
  const created = (data as { duel_id: string; is_new: boolean }[] | null)?.[0];
  if (error || !created) return { error: duelErrorText(error?.message) };

  if (created.is_new) waitUntil(notifyDuelInvitation({ duelId: created.duel_id }));

  refresh();
  redirect('/team/duelle');
}

/** The invitee accepts or declines. A no-longer-pending duel is reported by
 * the database as its current status and nothing happens here — a stale page
 * simply refreshes into the truth. Only a real acceptance notifies the
 * inviter; declining sends nothing to anyone. */
export async function respondDuelAction(duelId: string, accept: boolean) {
  await requireAuthUser();
  const supabase = await createClient();
  const { data } = await supabase.rpc('respond_team_duel', { p_duel_id: duelId, p_accept: accept });
  const result = (data as { duel_status: string; changed: boolean }[] | null)?.[0];
  if (result?.changed && result.duel_status === 'accepted') waitUntil(notifyDuelAccepted({ duelId }));
  refresh();
}

/** Either participant ends a duel (or withdraws an invitation) — no reason is
 * asked for or stored, and nobody is notified. */
export async function cancelDuelAction(duelId: string) {
  await requireAuthUser();
  const supabase = await createClient();
  await supabase.rpc('cancel_team_duel', { p_duel_id: duelId });
  refresh();
}
