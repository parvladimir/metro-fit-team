'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { Home, CalendarDays, Activity, Users, User } from 'lucide-react';
import { t } from '@/lib/i18n';

const ITEMS = [
  { href: '/', key: 'nav.home', icon: Home },
  { href: '/plan', key: 'nav.plan', icon: CalendarDays },
  { href: '/aktivitaet', key: 'nav.activity', icon: Activity },
  { href: '/team', key: 'nav.team', icon: Users },
  { href: '/profil', key: 'nav.profile', icon: User },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="sticky bottom-0 z-30 mx-auto w-full max-w-app bg-[#04141a]/85 px-3 pb-safe-b pt-2 backdrop-blur-md"
      aria-label="Hauptnavigation"
    >
      <div className="flex items-stretch justify-around rounded-[28px] border border-white/5 bg-neutral-100 px-1.5 py-1.5 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_16px_32px_-16px_rgba(0,0,0,0.6)]">
        {ITEMS.map(({ href, key, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 rounded-full py-2 text-[11px] font-semibold transition-colors duration-200',
                active ? 'bg-brand-50 text-brand' : 'text-neutral-400'
              )}
            >
              <Icon size={23} strokeWidth={active ? 2.4 : 1.9} />
              <span>{t(key)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
