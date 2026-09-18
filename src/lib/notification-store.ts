'use client';

import { useSyncExternalStore } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Personal reaction/reply notification count. Kept deliberately separate from
 * the team-chat unread store: different meaning, different source of truth
 * (notifications.read_at vs team_message_read_state).
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

export async function refreshNotificationCount(userId: string | null): Promise<void> {
  if (!userId) return;
  const { count: c, error } = await createClient()
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('category', 'reaktion_antwort')
    .is('read_at', null);
  if (error) return;
  count = c ?? 0;
  hydrated = true;
  emit();
}

export function useNotificationCount(initial: number): number {
  return useSyncExternalStore(
    subscribe,
    () => (hydrated ? count : initial),
    () => initial
  );
}

/** Sets/clears the app icon badge where the Badging API exists (feature-detected). */
export function syncAppBadge(n: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (n > 0 && nav.setAppBadge) void nav.setAppBadge(n).catch(() => undefined);
    else if (nav.clearAppBadge) void nav.clearAppBadge().catch(() => undefined);
  } catch {
    // unsupported / not installed — silently ignore
  }
}
