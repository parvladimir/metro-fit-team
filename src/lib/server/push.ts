import 'server-only';
import webpush from 'web-push';
import { publicEnv, getServerEnv } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { eventDeepLink, reactionText, replyText, firstName } from '@/lib/event-social';
import { stripMarkdown } from '@/lib/chat-format';

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

type PushSub = { id: string; endpoint: string; p256dh: string; auth: string };

async function deliver(admin: ReturnType<typeof createAdminClient>, subs: PushSub[], payload: string) {
  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      } catch (err) {
        const statusCode = (err as { statusCode?: number } | null)?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('id', sub.id);
        }
        // Other delivery errors are transient — keep the subscription.
      }
    })
  );
}

/**
 * Push for a reaction/reply on someone's activity event. Goes ONLY to the
 * event owner (never self), respects the "Reaktionen & Antworten" preference,
 * and carries just the actor's first name, the workout title and a short reply
 * preview. Every failure is swallowed — the in-app notification already exists.
 */
export async function notifyEventOwner(params: {
  ownerId: string;
  actorId: string;
  messageId: string;
  kind: 'reaction' | 'reply';
  eventTitle?: string | null;
  replyContent?: string;
}): Promise<void> {
  if (params.ownerId === params.actorId || !isPushConfigured()) return;
  try {
    ensureVapidConfigured();
    const admin = createAdminClient();
    const [{ data: actor }, { data: pref }, { data: subs }, { count }] = await Promise.all([
      admin.from('profiles').select('full_name').eq('id', params.actorId).single(),
      admin.from('notification_preferences').select('reaktionen_antworten').eq('user_id', params.ownerId).maybeSingle(),
      admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', params.ownerId),
      admin
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', params.ownerId)
        .in('category', ['reaktion_antwort', 'erwaehnung'])
        .is('read_at', null),
    ]);
    if (pref && pref.reaktionen_antworten === false) return;
    if (!subs || subs.length === 0) return;

    const actorName = actor?.full_name || 'Jemand';
    const body =
      params.kind === 'reply'
        ? replyText(actorName, params.replyContent ?? '')
        : reactionText(actorName, params.eventTitle);
    const payload = JSON.stringify({
      title: 'METRO Fit Team',
      body,
      url: eventDeepLink(params.messageId),
      tag: `event-${params.messageId}`,
      badgeCount: count ?? 1,
    });
    await deliver(admin, subs as PushSub[], payload);
  } catch {
    // never surface push failures
  }
}

/**
 * Notifies every other current member of `teamId` who has chat push enabled
 * and a live subscription. Fire-and-forget from the caller's perspective —
 * every failure is swallowed here (a dead subscription is cleaned up, any
 * other error is logged and ignored) so one bad recipient can never break
 * message sending itself.
 */
export async function notifyTeamOfNewChatMessage(params: {
  teamId: string;
  senderId: string;
  content: string;
  /** Users who get a dedicated mention push instead (never two pushes per message). */
  excludeUserIds?: string[];
}): Promise<void> {
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
    const excluded = new Set(params.excludeUserIds ?? []);
    const recipientIds = members.map((m) => m.user_id).filter((id) => !excluded.has(id));
    if (recipientIds.length === 0) return;

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

    await deliver(admin, subs as PushSub[], payload);
  } catch {
    // Push is an enhancement layered on top of the message that has already
    // been saved — never let a failure here surface to the sender.
  }
}

/**
 * One dedicated push per mentioned user ("X hat dich im Team-Chat erwähnt").
 * Returns the ids that should NOT additionally get the normal chat push
 * (everyone whose "Erwähnungen" preference is on) so a mention never produces
 * two notifications. Never throws.
 */
export async function notifyMentionedUsers(params: {
  authorId: string;
  /** the message that contains the mention */
  messageId: string;
  /** where the notification opens (the event for thread replies) */
  targetMessageId: string;
  userIds: string[];
  content: string;
}): Promise<string[]> {
  const ids = [...new Set(params.userIds)].filter((id) => id !== params.authorId);
  if (ids.length === 0) return [];
  try {
    const admin = createAdminClient();
    const { data: prefs } = await admin.from('notification_preferences').select('user_id, erwaehnungen').in('user_id', ids);
    const off = new Set((prefs ?? []).filter((p) => p.erwaehnungen === false).map((p) => p.user_id as string));
    const handled = ids.filter((id) => !off.has(id));
    if (handled.length === 0 || !isPushConfigured()) return handled;

    ensureVapidConfigured();
    const [{ data: author }, { data: subs }] = await Promise.all([
      admin.from('profiles').select('full_name').eq('id', params.authorId).single(),
      admin.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', handled),
    ]);
    const who = firstName(author?.full_name || 'Jemand');
    const preview = stripMarkdown(params.content);
    const body = preview.length > 110 ? `${preview.slice(0, 109)}…` : preview;

    for (const userId of handled) {
      const mine = (subs ?? []).filter((s) => s.user_id === userId);
      if (mine.length === 0) continue;
      const { count } = await admin
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('category', ['reaktion_antwort', 'erwaehnung'])
        .is('read_at', null);
      await deliver(
        admin,
        mine as PushSub[],
        JSON.stringify({
          title: `${who} hat dich im Team-Chat erwähnt`,
          body,
          url: eventDeepLink(params.targetMessageId),
          tag: `mention-${params.messageId}`,
          badgeCount: count ?? 1,
        })
      );
    }
    return handled;
  } catch {
    return [];
  }
}
