'use client';

import { useSyncExternalStore } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Client-side mirror of the server-side unread count. The database
 * (team_message_read_state + get_unread_chat_count) is the single source of
 * truth — this store only ever holds a value that came from that RPC (or
 * the server-rendered initial value), it is never "just set to zero".
 *
 * Why it exists: the (app) layout that renders the bottom nav is NOT
 * re-rendered on client-side navigations, so a count computed on the server
 * once goes stale the moment the user reads the chat and navigates away.
 */
let count = 0;
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export async function refreshUnread(teamId: string | null): Promise<void> {
  if (!teamId) return;
  const supabase = createClient();
  const { data, error } = await supabase.rpc('get_unread_chat_count', { p_team_id: teamId });
  if (error) return;
  count = Number(data ?? 0);
  hydrated = true;
  emit();
}

/** `initial` is the server-rendered value, used until the first RPC refresh. */
export function useUnreadCount(initial: number): number {
  return useSyncExternalStore(
    subscribe,
    () => (hydrated ? count : initial),
    () => initial
  );
}
