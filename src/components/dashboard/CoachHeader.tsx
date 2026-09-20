'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Sparkles, Trophy } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { buildCoachMessage, type CoachAccent, type CoachInput } from '@/lib/coach';

const ACCENT_CLASS: Record<CoachAccent, string> = {
  spark: 'text-brand',
  success: 'text-accent-success',
  gold: 'text-accent-achievement',
  challenge: 'text-accent-challenge',
};

function AccentIcon({ accent }: { accent: CoachAccent }) {
  const cls = `coach-pop shrink-0 ${ACCENT_CLASS[accent]}`;
  if (accent === 'success') return <CheckCircle2 size={22} strokeWidth={2.2} className={cls} aria-hidden />;
  if (accent === 'gold' || accent === 'challenge') return <Trophy size={21} strokeWidth={2.2} className={cls} aria-hidden />;
  return <Sparkles size={21} strokeWidth={2.2} className={cls} aria-hidden />;
}

/**
 * Contextual greeting + one motivation line + optional compact team row + one CTA.
 * The message comes from predefined templates (lib/coach) chosen by real data.
 * Time of day uses the viewer's local clock after mount; the server render uses
 * Berlin wall-clock so there is no layout jump for the usual audience.
 */
export function CoachHeader({
  input,
  userSeed,
  serverWall,
  serverNowMs,
}: {
  input: CoachInput;
  userSeed: string;
  serverWall: { y: number; m: number; day: number; h: number; min: number };
  serverNowMs: number;
}) {
  const [clock, setClock] = useState<{ wall: Date; ms: number }>(() => ({
    wall: new Date(serverWall.y, serverWall.m - 1, serverWall.day, serverWall.h, serverWall.min),
    ms: serverNowMs,
  }));
  useEffect(() => setClock({ wall: new Date(), ms: Date.now() }), []);

  const msg = useMemo(() => buildCoachMessage(input, clock.wall, userSeed, clock.ms), [input, clock, userSeed]);
  const celebrate = msg.headline !== null;

  return (
    <header className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h1 className="min-w-0 text-balance text-[22px] font-extrabold leading-tight tracking-[-0.01em] text-neutral-900 min-[360px]:text-page-title">
          {msg.greeting}
        </h1>
        <AccentIcon accent={msg.accent} />
      </div>

      {celebrate ? (
        <div className={`card card-accent coach-glow !rounded-2xl !p-4 ${msg.accent === 'gold' ? 'accent-gold' : 'accent-success'}`}>
          <p className="text-lg font-extrabold leading-snug text-neutral-900">{msg.headline}</p>
          <p className="mt-0.5 text-sm font-semibold text-neutral-700">{msg.line}</p>
          {msg.sub && <p className="mt-1 text-xs font-medium text-neutral-500">{msg.sub}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          <p className="coach-fade-up text-[15px] font-medium leading-snug text-neutral-700">{msg.line}</p>
          {msg.sub && <p className="coach-fade-up text-xs font-medium text-neutral-500" style={{ animationDelay: '60ms' }}>{msg.sub}</p>}
        </div>
      )}

      {msg.team && (
        <div className="coach-fade-up flex items-center gap-2 text-xs text-neutral-500" style={{ animationDelay: '140ms' }}>
          <Avatar src={msg.team.avatarUrl} name={msg.team.firstName} size="sm" className="!h-6 !w-6 !text-[10px]" />
          <p className="min-w-0 truncate">
            <span className="font-semibold text-neutral-700">{msg.team.firstName}</span> · {msg.team.what} · {msg.team.when}
          </p>
        </div>
      )}

      {msg.cta && (
        <Link href={msg.cta.href} className="btn-primary coach-fade-up mt-1 self-start !min-h-[40px] px-4 py-2 text-sm" style={{ animationDelay: '200ms' }}>
          {msg.cta.label}
        </Link>
      )}
    </header>
  );
}
