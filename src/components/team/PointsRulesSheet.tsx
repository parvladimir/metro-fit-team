'use client';

import { useState } from 'react';
import { CalendarCheck, Dumbbell, Footprints, Info, Target, Timer, Trophy, X, Zap } from 'lucide-react';
import { describePointsRules, type PointsAccent, type PointsRules } from '@/lib/points-rules';

const ICONS = { workout: Dumbbell, duration: Timer, weekly_goal: Target, consistency: CalendarCheck, steps: Footprints, challenge: Trophy } as const;
const ACCENT_CLASS: Record<PointsAccent, string> = {
  primary: 'accent-primary',
  info: 'accent-team',
  gold: 'accent-gold',
  success: 'accent-success',
  teal: '[--card-rgb:45_212_191]',
  challenge: 'accent-challenge',
};

/** "Punkteverteilung" link + bottom sheet explaining how points are earned (values from the team's live rules). */
export function PointsRulesSheet({ rules }: { rules: PointsRules }) {
  const [open, setOpen] = useState(false);
  const { items, capNote } = describePointsRules(rules);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-white/[0.1] bg-surface-3 px-3 text-xs font-semibold text-neutral-700 transition active:scale-95"
      >
        <Info size={14} strokeWidth={2.2} className="text-accent-info" />
        Punkteverteilung
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Punkteverteilung">
          <div
            className="mx-auto max-h-[88dvh] w-full max-w-app overflow-y-auto rounded-t-3xl border-t border-white/10 bg-surface-2 p-4"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300" />
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="icon-chip accent-gold h-9 w-9">
                  <Zap size={17} strokeWidth={2.2} />
                </span>
                <h2 className="text-lg font-bold text-neutral-900">Punkteverteilung</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Schließen" className="btn-icon">
                <X size={18} />
              </button>
            </div>

            <ul className="flex flex-col gap-2">
              {items.map((it) => {
                const Icon = ICONS[it.key];
                return (
                  <li key={it.key} className={`${ACCENT_CLASS[it.accent]} flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-surface-1 px-3 py-2.5`}>
                    <span className="icon-chip h-9 w-9">
                      <Icon size={17} strokeWidth={2.1} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-neutral-900">{it.title}</p>
                      {it.detail && <p className="text-xs leading-snug text-neutral-500">{it.detail}</p>}
                    </div>
                    {it.amount && (
                      <p className="shrink-0 text-right text-base font-extrabold tabular-nums text-neutral-900">
                        {it.amount}
                        <span className="ml-1 text-[11px] font-semibold text-neutral-500">Punkte</span>
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>

            {capNote && (
              <p className="mt-3 flex items-start gap-2 rounded-xl border border-white/[0.06] bg-surface-1 px-3 py-2.5 text-xs leading-relaxed text-neutral-600">
                <Info size={14} className="mt-0.5 shrink-0 text-accent-info" />
                {capNote}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
