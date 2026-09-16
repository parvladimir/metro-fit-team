'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { t } from '@/lib/i18n';

const ITEMS = [
  { href: '/', key: 'nav.home', icon: HomeIcon },
  { href: '/plan', key: 'nav.plan', icon: PlanIcon },
  { href: '/aktivitaet', key: 'nav.activity', icon: ActivityIcon },
  { href: '/team', key: 'nav.team', icon: TeamIcon },
  { href: '/profil', key: 'nav.profile', icon: ProfileIcon },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="sticky bottom-0 z-30 mx-auto flex w-full max-w-app items-stretch justify-around border-t border-neutral-200 bg-white/95 backdrop-blur pb-safe-b"
      aria-label="Hauptnavigation"
    >
      {ITEMS.map(({ href, key, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={clsx(
              'flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium',
              active ? 'text-brand' : 'text-neutral-400'
            )}
          >
            <Icon active={active} />
            <span>{t(key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

type IconProps = { active: boolean };

function HomeIcon({ active }: IconProps) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 2}>
      <path d="M3 11.5 12 4l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 10v9a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlanIcon({ active }: IconProps) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 2}>
      <rect x="4" y="4" width="16" height="17" rx="2" />
      <path d="M8 2.5v3M16 2.5v3M4 10h16" strokeLinecap="round" />
    </svg>
  );
}

function ActivityIcon({ active }: IconProps) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 2}>
      <path d="M3 12h3.5l2-6 4 12 2-8 1.5 2H21" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TeamIcon({ active }: IconProps) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 2}>
      <circle cx="9" cy="8" r="3" />
      <path d="M2.5 20c0-3.3 2.9-6 6.5-6s6.5 2.7 6.5 6" strokeLinecap="round" />
      <circle cx="17" cy="8" r="2.5" />
      <path d="M15.5 14.2c2.9.5 5 2.8 5 5.8" strokeLinecap="round" />
    </svg>
  );
}

function ProfileIcon({ active }: IconProps) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 2}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" strokeLinecap="round" />
    </svg>
  );
}
