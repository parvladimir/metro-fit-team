'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { refreshNotificationCount, syncAppBadge, useNotificationCount } from '@/lib/notification-store';

/** Keeps the personal notification count and the app icon badge current:
 * on mount, on focus, and live via Realtime on the user's own notifications. */
export function NotificationSync({ userId, initialCount }: { userId: string; initialCount: number }) {
  const count = useNotificationCount(initialCount);

  useEffect(() => {
    syncAppBadge(count);
  }, [count]);

  useEffect(() => {
    void refreshNotificationCount(userId);
    const onFocus = () => void refreshNotificationCount(userId);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled || !session) return;
      supabase.realtime.setAuth(session.access_token);
      channel = supabase
        .channel(`notifications:${userId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => {
          void refreshNotificationCount(userId);
        })
        .subscribe();
    });

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId]);

  return null;
}
