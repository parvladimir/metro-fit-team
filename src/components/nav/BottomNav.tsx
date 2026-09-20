'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { Home, CalendarDays, Activity, Users, User } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { refreshUnread, useUnreadCount } from '@/lib/unread-store';
import { useNotificationCount } from '@/lib/notification-store';
import { t } from '@/lib/i18n';

const ITEMS = [
  { href: '/', key: 'nav.home', icon: Home },
  { href: '/plan', key: 'nav.plan', icon: CalendarDays },
  { href: '/aktivitaet', key: 'nav.activity', icon: Activity },
  { href: '/team', key: 'nav.team', icon: Users },
  { href: '/profil', key: 'nav.profile', icon: User },
] as const;

export function BottomNav({ teamId, initialUnreadCount }: { teamId: string | null; initialUnreadCount: number }) {
  const pathname = usePathname();
  const unreadCount = useUnreadCount(initialUnreadCount);
  const personalCount = useNotificationCount(0);

  // Re-read the real count from the database on every navigation (the layout
  // itself is not re-rendered by client-side navigation) and when the app
  // regains focus (e.g. reopened PWA, another device read the chat).
  useEffect(() => {
    void refreshUnread(teamId);
  }, [teamId, pathname]);

  useEffect(() => {
    const onFocus = () => void refreshUnread(teamId);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [teamId]);

  // Live updates: any new HUMAN message from someone else triggers a fresh
  // count from the database (system events and own messages never count —
  // the RPC enforces that, this filter just avoids pointless round trips).
  useEffect(() => {
    if (!teamId) return;
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled || !session) return;
      supabase.realtime.setAuth(session.access_token);
      const myUserId = session.user.id;

      channel = supabase
        .channel(`unread:${teamId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `team_id=eq.${teamId}` },
          (payload) => {
            const row = payload.new as { user_id: string; message_type?: string };
            if (row.user_id === myUserId || row.message_type === 'system') return;
            void refreshUnread(teamId);
          }
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [teamId]);

  return (
    <nav
      className="sticky bottom-0 z-30 mx-auto w-full max-w-app px-3 pt-4"
      style={{
        // content fades out under the bar instead of colliding with it; safe-area aware
        paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))',
        background: 'linear-gradient(to top, #04141a 62%, rgba(4, 20, 26, 0) 100%)',
      }}
      aria-label="Hauptnavigation"
    >
      <div
        className="flex items-stretch justify-around rounded-[30px] border border-white/[0.12] px-1.5 py-1.5 backdrop-blur-xl"
        style={{
          background: 'linear-gradient(180deg, rgba(31, 56, 62, 0.92) 0%, rgba(17, 38, 43, 0.96) 100%)',
          boxShadow:
            'inset 0 1px 0 rgba(0, 215, 245, 0.22), inset 0 -1px 0 rgba(0, 0, 0, 0.3), 0 -10px 30px -14px rgba(0, 215, 245, 0.18), 0 16px 32px -14px rgba(0, 0, 0, 0.75)',
        }}
      >
        {ITEMS.map(({ href, key, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          const showBadge = href === '/team' && unreadCount > 0;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'relative flex min-h-[54px] flex-1 flex-col items-center justify-center gap-[3px] rounded-full py-2 text-[11px] leading-none transition-all duration-200 ease-out active:scale-95',
                active
                  ? 'bg-gradient-to-b from-brand/[0.26] to-brand/[0.09] font-bold text-brand shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_0_0_1px_rgba(0,215,245,0.4),0_6px_16px_-8px_rgba(0,215,245,0.55)]'
                  : 'font-semibold text-[#93B2B8]'
              )}
            >
              <span className="relative flex h-6 items-center justify-center">
                <Icon
                  size={23}
                  strokeWidth={active ? 2.4 : 2}
                  className={`transition-all duration-200 ${active ? 'scale-105 text-[#5CF0FF] drop-shadow-[0_0_6px_rgba(0,215,245,0.45)]' : 'text-[#86A9B0]'}`}
                />
                {href === '/team' && personalCount > 0 && (
                  <span
                    className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-brand ring-2 ring-[#152a2e]"
                    role="status"
                    aria-label="Neue Reaktionen oder Antworten"
                  />
                )}
                {showBadge && (
                  <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[9px] font-bold leading-none text-[#00232A] ring-2 ring-[#152a2e]">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </span>
              <span>{t(key)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
