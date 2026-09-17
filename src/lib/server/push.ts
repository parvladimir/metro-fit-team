import 'server-only';
import webpush from 'web-push';
import { publicEnv, getServerEnv } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';

let vapidConfigured = false;

function isPushConfigured(): boolean {
  return !!publicEnv.vapidPublicKey && !!getServerEnv().vapidPrivateKey;
}

function ensureVapidConfigured() {
  if (vapidConfigured) return;
  const { vapidPrivateKey } = getServerEnv();
  webpush.setVapidDetails('mailto:v.paryacool@gmail.com', publicEnv.vapidPublicKey!, vapidPrivateKey!);
  vapidConfigured = true;
}

/**
 * Notifies every other current member of `teamId` who has chat push enabled
 * and a live subscription. Fire-and-forget from the caller's perspective —
 * every failure is swallowed here (a dead subscription is cleaned up, any
 * other error is logged and ignored) so one bad recipient can never break
 * message sending itself.
 */
export async function notifyTeamOfNewChatMessage(params: { teamId: string; senderId: string; content: string }): Promise<void> {
  if (!isPushConfigured()) return;

  try {
    ensureVapidConfigured();
    const admin = createAdminClient();

    const [{ data: team }, { data: sender }, { data: members }] = await Promise.all([
      admin.from('teams').select('name').eq('id', params.teamId).single(),
      admin.from('profiles').select('full_name').eq('id', params.senderId).single(),
      admin.from('team_members').select('user_id').eq('team_id', params.teamId).neq('user_id', params.senderId),
    ]);

    if (!members || members.length === 0) return;
    const recipientIds = members.map((m) => m.user_id);

    const { data: prefs } = await admin
      .from('notification_preferences')
      .select('user_id, chat_nachrichten')
      .in('user_id', recipientIds);

    const optedIn = new Set((prefs ?? []).filter((p) => p.chat_nachrichten).map((p) => p.user_id));
    if (optedIn.size === 0) return;

    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .in('user_id', Array.from(optedIn));

    if (!subs || subs.length === 0) return;

    const senderName = sender?.full_name || 'Jemand';
    const payload = JSON.stringify({
      title: team?.name || 'Team-Chat',
      body: `${senderName}: ${params.content}`.slice(0, 160),
      url: '/team/chat',
    });

    await Promise.allSettled(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
        } catch (err) {
          const statusCode = (err as { statusCode?: number } | null)?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await admin.from('push_subscriptions').delete().eq('id', sub.id);
          }
          // Any other delivery error (network blip, provider outage) is
          // transient — leave the subscription in place and move on.
        }
      })
    );
  } catch {
    // Push is an enhancement layered on top of the message that has already
    // been saved — never let a failure here surface to the sender.
  }
}
