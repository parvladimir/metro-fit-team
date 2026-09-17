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
