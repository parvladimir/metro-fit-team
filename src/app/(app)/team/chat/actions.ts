'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAuthUser } from '@/lib/data/profile';

export async function sendMessageAction(formData: FormData) {
  const user = await requireAuthUser();
  const supabase = await createClient();

  const teamId = String(formData.get('teamId'));
  const content = String(formData.get('content') || '').trim();
  const replyToId = String(formData.get('replyToId') || '') || null;

  if (!content) return;

  await supabase.from('messages').insert({ team_id: teamId, user_id: user.id, content: content.slice(0, 2000), reply_to_id: replyToId });
  revalidatePath('/team/chat');
}
