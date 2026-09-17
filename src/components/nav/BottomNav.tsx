'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { Home, CalendarDays, Activity, Users, User } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
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
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);

  // The server recomputes this on every navigation (AppLayout re-runs), so
  // sync whenever the prop changes — BottomNav itself never remounts across
  // client-side navigations within the (app) layout.
  useEffect(() => {
    setUnreadCount(initialUnreadCount);
  }, [initialUnreadCount]);

  // Keep the badge live while the app stays open on some other screen —
  // increment on any new message that isn't the viewer's own, without
  // waiting for the next navigation to refetch the server-computed count.
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
            const row = payload.new as { user_id: string };
            if (row.user_id === myUserId) return;
            // Don't inflate the badge while the user is already looking at
            // the chat — that view marks itself read right away anyway.
            if (window.location.pathname === '/team/chat') return;
            setUnreadCount((c) => c + 1);
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
                active ? 'bg-brand-50 text-brand' : 'text-neutral-400'
              )}
            >
              <span className="relative">
                <Icon size={23} strokeWidth={active ? 2.4 : 1.9} />
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
