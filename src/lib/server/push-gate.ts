import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { passesPushGate, type GatePreferences, type PushCategory } from '@/lib/notification-gating';

export type { PushCategory };

/** Single-recipient gate check — category switch, then quiet hours, then
 * (for reminder/digest categories only) motivation pause. The decision itself
 * lives in `passesPushGate` (pure, unit-tested); this only reads the row. */
export async function shouldDeliverPush(userId: string, category: PushCategory, now: Date = new Date()): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('notification_preferences')
    .select(`${category}, quiet_hours_start, quiet_hours_end, motivation_paused_until`)
    .eq('user_id', userId)
    .maybeSingle();
  return passesPushGate((data as GatePreferences | null) ?? undefined, category, now);
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
  const byUser = new Map(((data as (GatePreferences & { user_id: string })[] | null) ?? []).map((p) => [p.user_id, p]));
  return userIds.filter((id) => passesPushGate(byUser.get(id), category, now));
}
