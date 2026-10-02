import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { isMotivationPaused, isWithinQuietHours } from '@/lib/notification-gating';
import type { NotificationPreferences } from '@/types/database';

/** Every `notification_preferences` boolean column that gates a push. */
export type PushCategory = Exclude<keyof NotificationPreferences, 'user_id'>;

/** Reminder/digest-style categories — these are what "Motivation pausieren"
 * pauses. Direct social interaction (reactions, replies, mentions, chat
 * messages) is deliberately excluded, per the spec's own "without losing
 * direct replies". */
const MOTIVATION_CATEGORIES: ReadonlySet<PushCategory> = new Set([
  'wochenzusammenfassung',
  'trainingserinnerung',
  'wochenziel',
  'messungserinnerung',
  'herausforderung',
  'team_aktivitaet',
]);

type GateRow = { quiet_hours_start: string | null; quiet_hours_end: string | null; motivation_paused_until: string | null } & Record<string, unknown>;

function passesGate(pref: GateRow | undefined, category: PushCategory, now: Date): boolean {
  if (!pref) return true; // fail-open: every profile gets a default row; a missing one is the rare/out-of-band case.
  if (pref[category] === false) return false;
  if (isWithinQuietHours(now, pref.quiet_hours_start, pref.quiet_hours_end)) return false;
  if (MOTIVATION_CATEGORIES.has(category) && isMotivationPaused(pref.motivation_paused_until, now)) return false;
  return true;
}

/** Single-recipient gate check — category boolean, then quiet hours, then
 * (for reminder/digest categories only) motivation pause. */
export async function shouldDeliverPush(userId: string, category: PushCategory, now: Date = new Date()): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('notification_preferences')
    .select(`${category}, quiet_hours_start, quiet_hours_end, motivation_paused_until`)
    .eq('user_id', userId)
    .maybeSingle();
  return passesGate((data as GateRow | null) ?? undefined, category, now);
}

/** Batch gate check for a broadcast-style send (e.g. a new chat message to
 * every team member) — one query for every candidate recipient rather than
 * one query per user. */
export async function filterPushRecipients(userIds: string[], category: PushCategory, now: Date = new Date()): Promise<string[]> {
  if (userIds.length === 0) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from('notification_preferences')
    .select(`user_id, ${category}, quiet_hours_start, quiet_hours_end, motivation_paused_until`)
    .in('user_id', userIds);
  const byUser = new Map(((data as (GateRow & { user_id: string })[] | null) ?? []).map((p) => [p.user_id, p]));
  return userIds.filter((id) => passesGate(byUser.get(id), category, now));
}
