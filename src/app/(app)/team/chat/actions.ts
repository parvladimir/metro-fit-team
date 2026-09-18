'use server';

import { revalidatePath } from 'next/cache';
import { waitUntil } from '@vercel/functions';
import { createClient } from '@/lib/supabase/server';
import { requireAuthUser } from '@/lib/data/profile';
import { notifyTeamOfNewChatMessage } from '@/lib/server/push';

export async function sendMessageAction(formData: FormData) {
  const user = await requireAuthUser();
  const supabase = await createClient();

  const teamId = String(formData.get('teamId'));
  const content = String(formData.get('content') || '').trim();
  const replyToId = String(formData.get('replyToId') || '') || null;

  if (!content) return;

  const trimmedContent = content.slice(0, 2000);
  await supabase.from('messages').insert({ team_id: teamId, user_id: user.id, content: trimmedContent, reply_to_id: replyToId });
  revalidatePath('/team/chat');

  // Best-effort push fan-out, kept running after the response is sent
  // (Vercel's waitUntil) so it never adds latency to sending a message —
  // and notifyTeamOfNewChatMessage itself swallows every failure, so a bad
  // subscription or provider outage can never surface here either way.
  waitUntil(notifyTeamOfNewChatMessage({ teamId, senderId: user.id, content: trimmedContent }));
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

  const caption = input.caption.trim().slice(0, 2000);
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
  waitUntil(notifyTeamOfNewChatMessage({ teamId: input.teamId, senderId: user.id, content: caption ? `📷 ${caption}` : '📷 Foto' }));
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
