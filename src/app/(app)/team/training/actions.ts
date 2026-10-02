'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { waitUntil } from '@vercel/functions';
import { createClient } from '@/lib/supabase/server';
import { requireAuthUser, getPrimaryTeamMembership } from '@/lib/data/profile';
import { cleanInviteInput, inviteErrorText, resolveInviteTime, type RsvpStatus, type TimeCheck } from '@/lib/training-invites';
import { notifyTrainingChanged, notifyTrainingInvitation } from '@/lib/server/push';

export interface TrainingFormState {
  error?: string;
  /** Set when the typed time does not exist / happens twice around a clock change and the organizer must pick. */
  timeCheck?: TimeCheck;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERIC = 'Das hat nicht geklappt. Bitte versuche es noch einmal.';

function refresh() {
  revalidatePath('/');
  revalidatePath('/team/chat');
}

/** Everything the two form actions do before touching the database: clean the
 * text fields, then turn the typed wall-clock time into an instant — or into
 * the question the form has to ask (a time that is skipped or repeated by a
 * clock change is never guessed). */
function readForm(formData: FormData) {
  const cleaned = cleanInviteInput({
    title: formData.get('title'),
    activityType: formData.get('activityType'),
    place: formData.get('place'),
    note: formData.get('note'),
    planShareId: formData.get('planShareId'),
  });
  if (!cleaned.ok) return { state: { error: inviteErrorText(cleaned.error) } as TrainingFormState };

  const time = resolveInviteTime(String(formData.get('startsAt') || ''), String(formData.get('timeChoice') || '') || null);
  switch (time.kind) {
    case 'invalid':
      return { state: { error: 'Bitte gib Datum und Uhrzeit an.' } as TrainingFormState };
    case 'past':
      return { state: { error: 'Dieser Zeitpunkt liegt in der Vergangenheit. Bitte wähle einen Zeitpunkt in der Zukunft.' } as TrainingFormState };
    case 'too_far':
      return { state: { error: inviteErrorText('invalid_start_time') } as TrainingFormState };
    case 'check':
      return { state: { timeCheck: time.check } as TrainingFormState };
    case 'ok':
      return { fields: cleaned.value, startsAt: time.instant.toISOString() };
  }
}

/** Publishes an invitation as ONE chat card. The invitation id is generated
 * when the form page renders and posted back as a hidden field, so a double
 * tap or a retry after a flaky network is idempotent: the database returns the
 * existing card and only a genuinely new one notifies anybody. */
export async function createTrainingInviteAction(_prev: TrainingFormState | undefined, formData: FormData): Promise<TrainingFormState> {
  const user = await requireAuthUser();
  const membership = await getPrimaryTeamMembership(user.id);
  if (!membership) return { error: inviteErrorText('not_a_team_member') };

  const inviteId = String(formData.get('inviteId') || '');
  if (!UUID_RE.test(inviteId)) return { error: GENERIC };
  const read = readForm(formData);
  if (!('fields' in read) || !read.fields) return read.state ?? { error: GENERIC };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('publish_training_invite', {
    p_invite_id: inviteId,
    p_team_id: membership.team_id,
    p_title: read.fields.title,
    p_starts_at: read.startsAt,
    p_activity_type: read.fields.activityType,
    p_place: read.fields.place,
    p_note: read.fields.note,
    p_plan_share_id: read.fields.planShareId,
  });
  const created = (data as { out_message_id: string; out_invite_id: string; is_new: boolean }[] | null)?.[0];
  if (error || !created) return { error: inviteErrorText(error?.message) };

  if (created.is_new) waitUntil(notifyTrainingInvitation({ inviteId: created.out_invite_id }));
  refresh();
  redirect(`/team/chat?message=${created.out_message_id}`);
}

/** Edits an invitation (organizer only). Only a changed time or place notifies
 * the people who answered — once; an identical re-submit changes and notifies
 * nothing. */
export async function updateTrainingInviteAction(_prev: TrainingFormState | undefined, formData: FormData): Promise<TrainingFormState> {
  const user = await requireAuthUser();
  const inviteId = String(formData.get('inviteId') || '');
  if (!UUID_RE.test(inviteId)) return { error: GENERIC };
  const read = readForm(formData);
  if (!('fields' in read) || !read.fields) return read.state ?? { error: GENERIC };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('update_training_invite', {
    p_invite_id: inviteId,
    p_title: read.fields.title,
    p_starts_at: read.startsAt,
    p_activity_type: read.fields.activityType,
    p_place: read.fields.place,
    p_note: read.fields.note,
    p_plan_share_id: read.fields.planShareId,
  });
  const result = (data as { changed: boolean; substantial: boolean; out_message_id: string }[] | null)?.[0];
  if (error || !result) return { error: inviteErrorText(error?.message) };

  if (result.changed && result.substantial) waitUntil(notifyTrainingChanged({ inviteId, kind: 'rescheduled', actorId: user.id }));
  refresh();
  redirect(`/team/chat?message=${result.out_message_id}`);
}

export type TrainingMutationResult = { ok: true } | { ok: false; error: string };

/** Cancels an invitation (organizer only, idempotent). People who answered are
 * told once — and only if it had not started yet. */
export async function cancelTrainingInviteAction(inviteId: string): Promise<TrainingMutationResult> {
  const user = await requireAuthUser();
  if (!UUID_RE.test(inviteId)) return { ok: false, error: GENERIC };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('cancel_training_invite', { p_invite_id: inviteId });
  const result = (data as { newly_cancelled: boolean; was_upcoming: boolean }[] | null)?.[0];
  if (error || !result) return { ok: false, error: inviteErrorText(error?.message) };
  if (result.newly_cancelled && result.was_upcoming) waitUntil(notifyTrainingChanged({ inviteId, kind: 'cancelled', actorId: user.id }));
  refresh();
  return { ok: true };
}

/** The caller's own answer — "going", "maybe", or null to withdraw it. Never
 * notifies anyone: answering is a quiet, non-binding signal. */
export async function setRsvpAction(inviteId: string, status: RsvpStatus | null): Promise<TrainingMutationResult> {
  await requireAuthUser();
  if (!UUID_RE.test(inviteId) || (status !== null && status !== 'going' && status !== 'maybe')) return { ok: false, error: GENERIC };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_training_invite_rsvp', { p_invite_id: inviteId, p_status: status });
  if (error) return { ok: false, error: inviteErrorText(error.message) };
  return { ok: true };
}
