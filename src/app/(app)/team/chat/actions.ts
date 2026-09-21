'use server';

import { revalidatePath } from 'next/cache';
import { waitUntil } from '@vercel/functions';
import { createClient } from '@/lib/supabase/server';
import { requireAuthUser } from '@/lib/data/profile';
import { notifyEventOwner, notifyMentionedUsers, notifyTeamOfNewChatMessage } from '@/lib/server/push';
import { parseMentionIds, syncMentions } from '@/lib/server/mentions';
import type { MessageMention } from '@/lib/mentions';
import { createAdminClient } from '@/lib/supabase/admin';
import { cleanReply, isValidMessageId, type EventReply } from '@/lib/event-social';
import { resolveAuthorName } from '@/lib/chat-identity';
import { stripMarkdown } from '@/lib/chat-format';
import { fetchCreators } from '@/lib/creator';
import { getEventSocial, getMessageMentions, getMessagesPage, type ChatMessage } from '@/lib/data/chat';
import type { EventSocial } from '@/lib/event-social';
import type { Message } from '@/types/database';

export type SendMessageResult =
  | { ok: true; message: ChatMessage; mentions: MessageMention[] }
  | { ok: false; error: string };

const SEND_FAILED = 'Nachricht konnte nicht gesendet werden.';

/**
 * Persists a chat message and returns the ROW THAT WAS ACTUALLY STORED. The UI
 * only shows a message as sent after this succeeds, and uses the returned id as
 * the source of truth (Realtime duplicates are matched on it).
 *
 * Order matters: the message insert is the only step that can fail the send.
 * Mention relations, notifications and push are secondary — their failure is
 * logged and swallowed and must never remove or "unsend" the message.
 */
export async function sendMessageAction(formData: FormData): Promise<SendMessageResult> {
  const user = await requireAuthUser();
  const supabase = await createClient();

  const teamId = String(formData.get('teamId'));
  const content = String(formData.get('content') || '').replace(/\r\n?/g, '\n').trim();
  const replyToId = String(formData.get('replyToId') || '') || null;

  if (!content) return { ok: false, error: 'Bitte eine Nachricht eingeben.' };

  const trimmedContent = content.slice(0, 2000);
  const { data: created, error } = await supabase
    .from('messages')
    .insert({ team_id: teamId, user_id: user.id, content: trimmedContent, reply_to_id: replyToId })
    .select('*, profiles(full_name, avatar_url)')
    .single();

  if (error || !created) {
    console.error('[chat] insert failed', error?.code, error?.message?.slice(0, 160));
    return { ok: false, error: SEND_FAILED };
  }

  let mentions: MessageMention[] = [];
  let added: string[] = [];
  const mentionIds = parseMentionIds(formData.get('mentions'));
  if (mentionIds.length) {
    try {
      const res = await syncMentions(supabase, { messageId: created.id, teamId, content: trimmedContent, requestedIds: mentionIds, authorId: user.id });
      mentions = res.mentions;
      added = res.added;
    } catch (err) {
      console.error('[chat] mention sync failed', err instanceof Error ? err.message.slice(0, 160) : 'unknown');
    }
  }

  revalidatePath('/team/chat');

  // Best-effort push fan-out after the response (Vercel's waitUntil): never adds
  // latency and every failure is swallowed inside the notifiers.
  waitUntil(
    (async () => {
      const handled = await notifyMentionedUsers({ authorId: user.id, messageId: created.id, targetMessageId: created.id, userIds: added, content: trimmedContent });
      await notifyTeamOfNewChatMessage({ teamId, senderId: user.id, content: stripMarkdown(trimmedContent), excludeUserIds: handled });
    })().catch(() => undefined)
  );

  const profile = (created as unknown as { profiles: { full_name: string | null; avatar_url: string | null } | null }).profiles;
  const creators = await fetchCreators(supabase, [user.id]).catch(() => new Map());
  const { profiles: _profiles, ...row } = created as unknown as Message & { profiles: unknown };
  void _profiles;
  return {
    ok: true,
    mentions,
    message: { ...row, authorName: resolveAuthorName(profile), authorAvatar: profile?.avatar_url ?? null, creatorName: creators.get(user.id)?.displayName ?? null },
  };
}

export type OlderMessagesResult = {
  messages: ChatMessage[];
  hasMore: boolean;
  mentions: Record<string, MessageMention[]>;
  social: Record<string, EventSocial>;
};

/** Older history for "Ältere Nachrichten laden" (RLS still scopes it to the caller's teams). */
export async function loadOlderMessagesAction(teamId: string, before: string): Promise<OlderMessagesResult> {
  await requireAuthUser();
  if (!/^[0-9a-f-]{36}$/i.test(teamId) || Number.isNaN(Date.parse(before))) return { messages: [], hasMore: false, mentions: {}, social: {} };
  const { messages, hasMore } = await getMessagesPage(teamId, { before });
  const [mentions, social] = await Promise.all([
    getMessageMentions(messages.filter((m) => m.message_type !== 'system').map((m) => m.id)),
    getEventSocial(messages.filter((m) => m.message_type === 'system').map((m) => m.id)),
  ]);
  return { messages, hasMore, mentions, social };
}

export type SendImageResult = { ok: true } | { ok: false; error: string };

/** Creates an image message AFTER the client uploaded the (already
 * compressed) files to the private chat-media bucket. Paths are validated
 * against the caller's own folder inside a team they belong to; on any
 * failure the uploaded objects are removed so no orphaned/empty message or
 * dangling file is left behind. */
export async function sendImageMessageAction(input: {
  teamId: string;
  messageId: string;
  path: string;
  thumbPath: string;
  mime: string;
  width: number;
  height: number;
  caption: string;
  mentionUserIds?: string[];
}): Promise<SendImageResult> {
  const user = await requireAuthUser();
  const supabase = await createClient();
  const prefix = `${input.teamId}/${user.id}/`;
  const uuid = /^[0-9a-f-]{36}$/;

  const valid =
    uuid.test(input.teamId) &&
    uuid.test(input.messageId) &&
    input.path.startsWith(prefix) &&
    input.thumbPath.startsWith(prefix) &&
    !input.path.includes('..') &&
    !input.thumbPath.includes('..') &&
    ['image/webp', 'image/jpeg'].includes(input.mime) &&
    Number.isInteger(input.width) && input.width > 0 && input.width <= 4096 &&
    Number.isInteger(input.height) && input.height > 0 && input.height <= 4096;

  const cleanup = () => supabase.storage.from('chat-media').remove([input.path, input.thumbPath]);

  if (!valid) {
    if (input.path.startsWith(prefix)) await cleanup();
    return { ok: false, error: 'Bild konnte nicht gesendet werden.' };
  }

  const caption = input.caption.replace(/\r\n?/g, '\n').trim().slice(0, 2000);
  const { error } = await supabase.from('messages').insert({
    id: input.messageId,
    team_id: input.teamId,
    user_id: user.id,
    content: caption,
    message_type: 'image',
    attachment_path: input.path,
    attachment_mime: input.mime,
    attachment_width: input.width,
    attachment_height: input.height,
    metadata: { thumb_path: input.thumbPath },
  });

  if (error) {
    await cleanup();
    return { ok: false, error: 'Bild konnte nicht gesendet werden.' };
  }

  revalidatePath('/team/chat');
  const added = caption && input.mentionUserIds?.length
    ? (await syncMentions(supabase, { messageId: input.messageId, teamId: input.teamId, content: caption, requestedIds: parseMentionIds(input.mentionUserIds), authorId: user.id })).added
    : [];
  waitUntil(
    (async () => {
      const handled = await notifyMentionedUsers({ authorId: user.id, messageId: input.messageId, targetMessageId: input.messageId, userIds: added, content: caption });
      await notifyTeamOfNewChatMessage({ teamId: input.teamId, senderId: user.id, content: caption ? `📷 ${caption}` : '📷 Foto', excludeUserIds: handled });
    })()
  );
  return { ok: true };
}

/** Marks the team's chat as read up to `latestMessageId` for the current
 * user. Called client-side, after the chat page has actually mounted and
 * displayed messages — never as a side effect of merely rendering the Team
 * page or a route prefetch. */
export async function markChatReadAction(teamId: string, latestMessageId: string | null) {
  const user = await requireAuthUser();
  const supabase = await createClient();

  await supabase.from('team_message_read_state').upsert(
    {
      user_id: user.id,
      team_id: teamId,
      last_read_message_id: latestMessageId,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,team_id' }
  );
}

/** Persists a browser push subscription for the current user. Called after
 * the client has already obtained Notification permission and subscribed
 * via the Push API — this only stores the resulting endpoint/keys. */
export async function savePushSubscriptionAction(sub: { endpoint: string; p256dh: string; auth: string }) {
  const user = await requireAuthUser();
  const supabase = await createClient();

  await supabase
    .from('push_subscriptions')
    .upsert({ user_id: user.id, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, { onConflict: 'endpoint' });
}

export type SupportResult = { ok: true; reacted: boolean } | { ok: false };

/** Toggles the caller's "support" on an activity event. RLS restricts this to
 * current team members acting as themselves. A push goes out only on the
 * transition not-reacted → reacted AND only the first time this person ever
 * supports this event (the DB keeps one notification per owner/event/actor),
 * so toggling repeatedly can never spam the owner. */
export async function toggleSupportAction(messageId: string): Promise<SupportResult> {
  if (!isValidMessageId(messageId)) return { ok: false };
  const user = await requireAuthUser();
  const supabase = await createClient();

  const { data: event } = await supabase
    .from('messages')
    .select('id, user_id, metadata, message_type')
    .eq('id', messageId)
    .maybeSingle();
  if (!event || event.message_type !== 'system') return { ok: false };

  const { data: existing } = await supabase
    .from('message_reactions')
    .select('id')
    .eq('message_id', messageId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from('message_reactions').delete().eq('id', existing.id);
    return error ? { ok: false } : { ok: true, reacted: false };
  }

  let firstTime = false;
  if (event.user_id !== user.id) {
    const { count } = await createAdminClient()
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', event.user_id)
      .eq('message_id', messageId)
      .eq('actor_id', user.id)
      .eq('kind', 'reaction');
    firstTime = (count ?? 0) === 0;
  }

  const { error } = await supabase.from('message_reactions').insert({ message_id: messageId, user_id: user.id });
  if (error && error.code !== '23505') return { ok: false };

  if (!error && firstTime) {
    const title = typeof event.metadata?.title === 'string' ? (event.metadata.title as string) : null;
    waitUntil(notifyEventOwner({ ownerId: event.user_id, actorId: user.id, messageId, kind: 'reaction', eventTitle: title }));
  }
  return { ok: true, reacted: true };
}

export type EventReplyResult = { ok: true; reply: EventReply } | { ok: false; error: string };

/** Adds a one-level reply to an activity event (server validates the parent
 * again via a DB trigger) and notifies the event owner. */
export async function sendEventReplyAction(messageId: string, rawContent: string, mentionUserIds: string[] = []): Promise<EventReplyResult> {
  const content = cleanReply(rawContent);
  if (!isValidMessageId(messageId) || !content) return { ok: false, error: 'Bitte eine Antwort eingeben.' };
  const user = await requireAuthUser();
  const supabase = await createClient();

  const { data: event } = await supabase.from('messages').select('id, team_id, user_id, message_type').eq('id', messageId).maybeSingle();
  if (!event || event.message_type !== 'system') return { ok: false, error: 'Antwort konnte nicht gesendet werden.' };

  const { data: row, error } = await supabase
    .from('messages')
    .insert({ team_id: event.team_id, user_id: user.id, content, parent_message_id: messageId })
    .select('id, created_at, profiles(full_name, avatar_url)')
    .single();
  if (error || !row) return { ok: false, error: 'Antwort konnte nicht gesendet werden.' };

  const { data: meta } = await supabase.from('messages').select('metadata').eq('id', messageId).maybeSingle();
  const title = typeof meta?.metadata?.title === 'string' ? (meta.metadata.title as string) : null;
  const added = mentionUserIds.length
    ? (await syncMentions(supabase, { messageId: row.id, teamId: event.team_id, content, requestedIds: parseMentionIds(mentionUserIds), authorId: user.id })).added
    : [];
  waitUntil(
    (async () => {
      const handled = await notifyMentionedUsers({ authorId: user.id, messageId: row.id, targetMessageId: messageId, userIds: added, content });
      // the owner gets the mention push instead of a second "geantwortet" push
      if (!handled.includes(event.user_id)) {
        await notifyEventOwner({ ownerId: event.user_id, actorId: user.id, messageId, kind: 'reply', eventTitle: title, replyContent: content });
      }
    })()
  );

  const profile = (row as unknown as { profiles: { full_name: string | null; avatar_url: string | null } | null }).profiles;
  return {
    ok: true,
    reply: {
      id: row.id,
      user_id: user.id,
      content,
      created_at: row.created_at,
      authorName: resolveAuthorName(profile),
      authorAvatar: profile?.avatar_url ?? null,
    },
  };
}

/** Marks the caller's reaction/reply notifications as read — for one event
 * (opened via deep link) or all of them. */
export async function markNotificationsReadAction(messageId?: string) {
  const user = await requireAuthUser();
  const supabase = await createClient();
  let q = supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .in('category', ['reaktion_antwort', 'erwaehnung'])
    .is('read_at', null);
  if (messageId && isValidMessageId(messageId)) q = q.eq('message_id', messageId);
  await q;
}

export type EditMessageResult = { ok: true; content: string; edited_at: string; mentions: MessageMention[] } | { ok: false; error: string };

/** Edits the caller's own human message IN PLACE (same row, same id). RLS +
 * the guard_message_update trigger enforce ownership and forbid touching
 * anything but the content. Deliberately sends no push and creates no
 * notification — editing must be silent and never affects unread counts. */
export async function editMessageAction(messageId: string, rawContent: string, mentionUserIds: string[] = []): Promise<EditMessageResult> {
  if (!isValidMessageId(messageId)) return { ok: false, error: 'Nachricht nicht gefunden.' };
  const content = rawContent.replace(/\r\n?/g, '\n').trim().slice(0, 2000);
  const user = await requireAuthUser();
  const supabase = await createClient();

  const { data: current } = await supabase
    .from('messages')
    .select('message_type, content, team_id')
    .eq('id', messageId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!current || current.message_type === 'system') return { ok: false, error: 'Diese Nachricht kann nicht bearbeitet werden.' };
  if (!content && current.message_type !== 'image') return { ok: false, error: 'Die Nachricht darf nicht leer sein.' };
  if (content === current.content) {
    const { data: rows } = await supabase.from('message_mentions').select('mentioned_user_id, mention_text').eq('message_id', messageId);
    return {
      ok: true,
      content,
      edited_at: new Date().toISOString(),
      mentions: (rows ?? []).map((r) => ({ userId: r.mentioned_user_id as string, text: r.mention_text as string })),
    };
  }

  const { data, error } = await supabase
    .from('messages')
    .update({ content })
    .eq('id', messageId)
    .eq('user_id', user.id)
    .select('content, edited_at')
    .maybeSingle();
  if (error || !data) return { ok: false, error: 'Nachricht konnte nicht gespeichert werden.' };
  // Keep the relation in sync with the edited text. NO push here, and the DB
  // never creates a mention notification for an already-edited message, so
  // repeated edits can't spam anyone.
  const { mentions } = await syncMentions(supabase, {
    messageId,
    teamId: current.team_id,
    content: data.content,
    requestedIds: parseMentionIds(mentionUserIds),
    authorId: user.id,
  });
  revalidatePath('/team/chat');
  return { ok: true, content: data.content, edited_at: data.edited_at ?? new Date().toISOString(), mentions };
}

/** Soft-deletes the caller's own human message (deleted_at). */
export async function deleteMessageAction(messageId: string): Promise<{ ok: boolean }> {
  if (!isValidMessageId(messageId)) return { ok: false };
  const user = await requireAuthUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', messageId)
    .eq('user_id', user.id)
    .neq('message_type', 'system')
    .select('id')
    .maybeSingle();
  if (!error && data) revalidatePath('/team/chat');
  return { ok: !error && !!data };
}
