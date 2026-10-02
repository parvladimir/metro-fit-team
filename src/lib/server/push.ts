import 'server-only';
import webpush from 'web-push';
import { publicEnv, getServerEnv } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { eventDeepLink, replyText, firstName } from '@/lib/event-social';
import { reactionText, type ReactionKey } from '@/lib/reactions';
import { stripMarkdown } from '@/lib/chat-format';
import { shouldDeliverPush, filterPushRecipients } from '@/lib/server/push-gate';

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
  /** Required for kind: 'reaction' — which of the 20 emoji was used. */
  reactionKey?: ReactionKey;
  /** Required for kind: 'reaction' — workout event vs. an ordinary message. */
  isWorkoutEvent?: boolean;
}): Promise<void> {
  if (params.ownerId === params.actorId || !isPushConfigured()) return;
  try {
    ensureVapidConfigured();
    const admin = createAdminClient();
    const [{ data: actor }, deliverable, { data: subs }, { count }] = await Promise.all([
      admin.from('profiles').select('full_name').eq('id', params.actorId).single(),
      shouldDeliverPush(params.ownerId, 'reaktionen_antworten'),
      admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', params.ownerId),
      admin
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', params.ownerId)
        .in('category', ['reaktion_antwort', 'erwaehnung'])
        .is('read_at', null),
    ]);
    if (!deliverable) return;
    if (!subs || subs.length === 0) return;

    const actorName = actor?.full_name || 'Jemand';
    const body =
      params.kind === 'reply'
        ? replyText(actorName, params.replyContent ?? '')
        : reactionText(actorName, params.reactionKey ?? 'heart', params.isWorkoutEvent, params.eventTitle);
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

    const optedIn = await filterPushRecipients(recipientIds, 'chat_nachrichten');
    if (optedIn.length === 0) return;

    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .in('user_id', optedIn);

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
    const handled = await filterPushRecipients(ids, 'erwaehnungen');
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

/**
 * One-time "your weekly recap is ready" push, sent by `ensureWeeklyRecapGenerated`
 * right after a personal recap row is first created (or was never
 * successfully notified). Reuses the existing, already-built
 * "Wochenzusammenfassung" preference — gated through the shared push-gate
 * (category + quiet hours + motivation pause), unlike the three senders
 * above, which predate it. Never throws; the caller marks the row notified
 * regardless of outcome, so a permanently-unreachable subscription doesn't
 * retry forever.
 */
export async function notifyWeeklyRecapReady(params: { userId: string; completedWorkouts: number; points: number }): Promise<void> {
  if (!isPushConfigured()) return;
  try {
    const deliverable = await shouldDeliverPush(params.userId, 'wochenzusammenfassung');
    if (!deliverable) return;

    const admin = createAdminClient();
    const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', params.userId);
    if (!subs || subs.length === 0) return;

    ensureVapidConfigured();
    const body =
      params.completedWorkouts > 0
        ? `${params.completedWorkouts} Trainings · ${params.points} Punkte letzte Woche. Dein Rückblick ist da.`
        : 'Dein Wochenrückblick ist da.';
    const payload = JSON.stringify({
      title: 'METRO Fit Team',
      body,
      url: '/profil/rueckblick',
      tag: 'weekly-recap',
    });
    await deliver(admin, subs as PushSub[], payload);
  } catch {
    // never surface push failures
  }
}

/**
 * Shared sender for the two duel notifications. The duel is re-read first and
 * nothing goes out unless it is in the state the notification is about
 * (still a live pending invitation / actually accepted) between two CURRENT
 * team members, and the recipient has explicitly opted in to "Duelle" (the
 * shared gate fails closed for that category and applies quiet hours). The
 * text carries only the other person's first name — never the goal, the dates
 * or anything else about the duel. Never throws.
 */
async function notifyDuelParticipant(params: {
  duelId: string;
  expect: 'pending' | 'accepted';
  toRole: 'inviter' | 'invitee';
  text: (actorFirstName: string) => string;
}): Promise<void> {
  if (!isPushConfigured()) return;
  try {
    const admin = createAdminClient();
    const { data: duel } = await admin
      .from('team_duels')
      .select('team_id, inviter_id, invitee_id, status, expires_at')
      .eq('id', params.duelId)
      .maybeSingle();
    if (!duel || duel.status !== params.expect) return;
    if (duel.status === 'pending' && new Date(duel.expires_at).getTime() <= Date.now()) return;

    const recipientId = params.toRole === 'invitee' ? duel.invitee_id : duel.inviter_id;
    const actorId = params.toRole === 'invitee' ? duel.inviter_id : duel.invitee_id;

    const { data: members } = await admin
      .from('team_members')
      .select('user_id')
      .eq('team_id', duel.team_id)
      .in('user_id', [duel.inviter_id, duel.invitee_id]);
    if ((members ?? []).length < 2) return;
    if (!(await shouldDeliverPush(recipientId, 'duelle'))) return;

    const [{ data: subs }, { data: actor }] = await Promise.all([
      admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', recipientId),
      admin.from('profiles').select('full_name').eq('id', actorId).single(),
    ]);
    if (!subs || subs.length === 0) return;

    ensureVapidConfigured();
    await deliver(
      admin,
      subs as PushSub[],
      JSON.stringify({
        title: 'METRO Fit Team',
        body: params.text(firstName(actor?.full_name || 'Jemand')),
        url: '/team/duelle',
        tag: `duel-${params.duelId}`,
      })
    );
  } catch {
    // never surface push failures
  }
}

/** "X lädt dich zu einem Freundschaftsduell ein." — to the invitee, once, right
 * after a NEW invitation was created (callers pass it only when the database
 * reported `is_new`, so a retried submit never notifies twice). */
export async function notifyDuelInvitation(params: { duelId: string }): Promise<void> {
  await notifyDuelParticipant({
    duelId: params.duelId,
    expect: 'pending',
    toRole: 'invitee',
    text: (who) => `${who} lädt dich zu einem Freundschaftsduell ein.`,
  });
}

/** "X hat dein Duell angenommen." — to the inviter, once, when the invitee
 * accepts. Declining, withdrawing and expiry deliberately send nothing. */
export async function notifyDuelAccepted(params: { duelId: string }): Promise<void> {
  await notifyDuelParticipant({
    duelId: params.duelId,
    expect: 'accepted',
    toRole: 'inviter',
    text: (who) => `${who} hat dein Duell angenommen.`,
  });
}
