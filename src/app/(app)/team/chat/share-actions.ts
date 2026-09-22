'use server';

import { revalidatePath } from 'next/cache';
import { waitUntil } from '@vercel/functions';
import { createClient } from '@/lib/supabase/server';
import { requireAuthUser } from '@/lib/data/profile';
import { notifyTeamOfNewChatMessage } from '@/lib/server/push';
import { resolveAuthorName } from '@/lib/chat-identity';
import { fetchCreators } from '@/lib/creator';
import { getPlanShare, type PlanShareWithItems } from '@/lib/data/plan-shares';
import type { ChatMessage } from '@/lib/data/chat';
import type { Message } from '@/types/database';

const GENERIC_FAILED = 'Das hat leider nicht funktioniert. Bitte versuche es erneut.';

export type SharePlanInput = {
  teamId: string;
  sourceType: 'template' | 'workout';
  sourceTemplateId?: string | null;
  sourcePlanDayId?: string | null;
  sourceWorkoutId?: string | null;
  title?: string;
  note?: string;
  shareWeights?: boolean;
  shareInstructions?: boolean;
  shareActualSummary?: boolean;
};

export type SharePlanResult = { ok: true; message: ChatMessage; share: PlanShareWithItems } | { ok: false; error: string };

/** Publishes a template/day/workout into the team chat as a structured,
 * immutable share. Mirrors sendMessageAction's shape (returns the persisted
 * row) so the sender sees it instantly, same as a normal text message. */
export async function sharePlanAction(input: SharePlanInput): Promise<SharePlanResult> {
  const user = await requireAuthUser();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('publish_plan_share', {
    p_team_id: input.teamId,
    p_source_type: input.sourceType,
    p_source_template_id: input.sourceTemplateId ?? null,
    p_source_plan_day_id: input.sourcePlanDayId ?? null,
    p_source_workout_id: input.sourceWorkoutId ?? null,
    p_title: input.title?.trim() || null,
    p_note: input.note?.trim() || null,
    p_share_weights: !!input.shareWeights,
    p_share_instructions: !!input.shareInstructions,
    p_share_actual_summary: !!input.shareActualSummary,
  });

  if (error || !data?.[0]) {
    console.error('[plan-shares] publish failed', error?.code, error?.message?.slice(0, 160));
    return { ok: false, error: GENERIC_FAILED };
  }

  const { message_id, share_id } = data[0];
  const [{ data: row }, share] = await Promise.all([
    supabase.from('messages').select('*, profiles(full_name, avatar_url)').eq('id', message_id).single(),
    getPlanShare(share_id),
  ]);
  if (!row || !share) return { ok: false, error: GENERIC_FAILED };

  revalidatePath('/team/chat');

  waitUntil(
    notifyTeamOfNewChatMessage({
      teamId: input.teamId,
      senderId: user.id,
      content: `hat ${input.sourceType === 'workout' ? 'ein abgeschlossenes Training' : 'eine Trainingsvorlage'} geteilt.`,
      excludeUserIds: [],
    }).catch(() => undefined),
  );

  const profile = (row as unknown as { profiles: { full_name: string | null; avatar_url: string | null } | null }).profiles;
  const creators = await fetchCreators(supabase, [user.id]).catch(() => new Map());
  const { profiles: _profiles, ...message } = row as unknown as Message & { profiles: unknown };
  void _profiles;
  return {
    ok: true,
    share,
    message: { ...message, authorName: resolveAuthorName(profile), authorAvatar: profile?.avatar_url ?? null, creatorName: creators.get(user.id)?.displayName ?? null },
  };
}

export type ShareActionResult = { ok: true } | { ok: false; error: string };

/** Author-only. Keeps the message/card visible but stops future imports. */
export async function withdrawShareAction(shareId: string): Promise<ShareActionResult> {
  await requireAuthUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc('withdraw_plan_share', { p_share_id: shareId });
  if (error) {
    console.error('[plan-shares] withdraw failed', error.code, error.message?.slice(0, 160));
    return { ok: false, error: 'Freigabe konnte nicht zurückgezogen werden.' };
  }
  revalidatePath('/team/chat');
  return { ok: true };
}

export type ImportShareResult = { ok: true; templateId: string; alreadyImported: boolean } | { ok: false; error: string };

/** Creates an independent personal template from a share. Idempotent by
 * default — a second call returns the same live copy instead of a
 * duplicate; forceNewCopy explicitly makes another one. */
export async function importShareAction(
  shareId: string,
  name: string,
  keepWeights: boolean,
  forceNewCopy = false,
): Promise<ImportShareResult> {
  await requireAuthUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('import_plan_share', {
    p_share_id: shareId,
    p_name: name.trim() || null,
    p_keep_weights: keepWeights,
    p_force_new_copy: forceNewCopy,
  });
  if (error || !data?.[0]) {
    console.error('[plan-shares] import failed', error?.code, error?.message?.slice(0, 160));
    return { ok: false, error: 'Vorlage konnte nicht gespeichert werden.' };
  }
  revalidatePath('/plan');
  return { ok: true, templateId: data[0].template_id, alreadyImported: data[0].already_imported };
}
