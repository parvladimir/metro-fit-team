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
      className="sticky bottom-0 z-30 mx-auto w-full max-w-app bg-[#04141a]/85 px-3 pb-safe-b pt-2 backdrop-blur-md"
      aria-label="Hauptnavigation"
    >
      <div className="flex items-stretch justify-around rounded-[28px] border border-white/5 bg-neutral-100 px-1.5 py-1.5 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_16px_32px_-16px_rgba(0,0,0,0.6)]">
        {ITEMS.map(({ href, key, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          const showBadge = href === '/team' && unreadCount > 0;
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 rounded-full py-2 text-[11px] font-semibold transition-colors duration-200',
                active ? 'bg-brand-50 text-brand' : 'text-[#6F8E95]'
              )}
            >
              <span className="relative">
                <Icon size={23} strokeWidth={active ? 2.4 : 1.9} className={active ? undefined : 'text-[#5C8790]'} />
                {href === '/team' && personalCount > 0 && (
                  <span
                    className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-brand ring-2 ring-neutral-100"
                    role="status"
                    aria-label="Neue Reaktionen oder Antworten"
                  />
                )}
                {showBadge && (
                  <span className="absolute -right-2 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[9px] font-bold leading-none text-[#00232A]">
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
