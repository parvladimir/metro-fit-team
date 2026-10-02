import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { TRAINING_INVITE_SELECT, toInviteForViewer, type RawInviteRow, type TrainingInviteForViewer } from '@/lib/training-invites';

/** Invitation cards for a page of chat messages, keyed by message id — one
 * batched query, like the other chat-card loaders. Only messages that really
 * are an invitation get an entry. Never throws: if the tables are missing
 * (code deployed before its migration) the answer is "no cards", and those
 * messages simply render as the plain sentence they also contain. */
export async function getTrainingInvitesForViewer(messageIds: string[], viewerId: string): Promise<Record<string, TrainingInviteForViewer>> {
  if (messageIds.length === 0) return {};
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from('training_invites').select(TRAINING_INVITE_SELECT).in('message_id', messageIds);
    if (error || !data) return {};
    const out: Record<string, TrainingInviteForViewer> = {};
    for (const row of data as unknown as RawInviteRow[]) out[row.message_id] = toInviteForViewer(row, viewerId);
    return out;
  } catch {
    return {};
  }
}

/** The next open invitation starting within `withinDays` (default 3), for the
 * Home card. A cancelled invitation, one that has started and one whose chat
 * message was deleted never show. Instants only — no calendar-day arithmetic
 * that a UTC server could get wrong near Berlin midnight. */
export async function getUpcomingTrainingInvite(teamId: string, viewerId: string, now: Date = new Date(), withinDays = 3): Promise<TrainingInviteForViewer | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('training_invites')
      .select(`${TRAINING_INVITE_SELECT}, message:messages!training_invites_message_id_fkey!inner(deleted_at)`)
      .eq('team_id', teamId)
      .is('cancelled_at', null)
      .gt('starts_at', now.toISOString())
      .lte('starts_at', new Date(now.getTime() + withinDays * 86_400_000).toISOString())
      .is('message.deleted_at', null)
      .order('starts_at', { ascending: true })
      .limit(1);
    if (error || !data || data.length === 0) return null;
    return toInviteForViewer(data[0] as unknown as RawInviteRow, viewerId);
  } catch {
    return null;
  }
}

/** One invitation for the edit form — only for its organizer, and only while
 * it can still be edited (open, not cancelled). */
export async function getInviteForEdit(inviteId: string, viewerId: string): Promise<TrainingInviteForViewer | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from('training_invites').select(TRAINING_INVITE_SELECT).eq('id', inviteId).maybeSingle();
    if (!data) return null;
    const invite = toInviteForViewer(data as unknown as RawInviteRow, viewerId);
    return invite.organizerId === viewerId && !invite.cancelledAt ? invite : null;
  } catch {
    return null;
  }
}

/** Live shared templates of the team, for the optional "Vorlage verknüpfen"
 * choice — id and title only; whatever the share contains stays behind its
 * own access rules. */
export async function getTeamShareOptions(teamId: string): Promise<{ id: string; title: string }[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('plan_shares')
      .select('id, title')
      .eq('team_id', teamId)
      .is('withdrawn_at', null)
      .order('created_at', { ascending: false })
      .limit(50);
    return (data ?? []) as { id: string; title: string }[];
  } catch {
    return [];
  }
}
