'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Pause, Play } from 'lucide-react';
import { startReviewAction } from '@/app/(app)/aktivitaet/actions';
import { PauseResumeButton } from '@/components/workout/PauseResumeButton';
import { useElapsedSeconds } from '@/lib/use-elapsed-seconds';
import { formatDuration } from '@/lib/workout-metrics';
import { isLongWorkout, needsGentleReminder } from '@/lib/workout-timer';
import type { ActiveWorkout } from '@/lib/data/workouts';

/** Owner-only running-workout indicator, visible across the shared app shell
 * so a timer is never silently forgotten while browsing elsewhere. `fixed`
 * (not `sticky`, which BottomNav already uses and wouldn't stack correctly
 * with a second sticky sibling) at the same offset the training detail
 * page's own action bar already uses, so it never covers the bottom nav.
 * Hidden on the workout's own detail/review pages, where the full controls
 * already exist and a second copy would be redundant — and on the team chat
 * route, whose composer already occupies this exact band above the bottom
 * nav (a fixed-position strip there would cover it, which the spec this
 * component implements explicitly forbids; discoverability is still covered
 * on the other five app-shell destinations). */
export function RunningWorkoutStrip({ workout }: { workout: ActiveWorkout | null }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const elapsed = useElapsedSeconds({
    startedAt: workout?.started_at ?? new Date().toISOString(),
    pausedSeconds: workout?.paused_seconds ?? 0,
    pausedAt: workout?.paused_at ?? null,
  });

  if (!workout || pathname.startsWith(`/aktivitaet/training/${workout.id}`) || pathname.startsWith('/team/chat')) return null;

  const paused = !!workout.paused_at;
  const color = isLongWorkout(elapsed) ? 'text-amber-400' : needsGentleReminder(elapsed) ? 'text-amber-300' : 'text-brand';

  return (
    <div className="fixed left-1/2 z-30 w-full max-w-app -translate-x-1/2 px-4" style={{ bottom: 'calc(5.25rem + env(safe-area-inset-bottom))' }}>
      <div
        className="rounded-2xl border border-white/[0.12] shadow-lg backdrop-blur-xl"
        style={{ background: 'linear-gradient(180deg, rgba(31, 56, 62, 0.94) 0%, rgba(17, 38, 43, 0.97) 100%)' }}
      >
        <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left">
          <span className={`shrink-0 ${color}`} aria-hidden>
            {paused ? <Pause size={16} strokeWidth={2.25} /> : <Play size={16} strokeWidth={2.25} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-bold text-neutral-900">
              {paused ? 'Training pausiert' : 'Training läuft'} · <span className="tabular-nums">{formatDuration(elapsed)}</span>
            </span>
            {workout.title && <span className="block truncate text-[11px] text-neutral-500">{workout.title}</span>}
          </span>
        </button>

        {expanded && (
          <div className="flex gap-2 border-t border-white/[0.08] p-2.5">
            <PauseResumeButton
              workoutId={workout.id}
              paused={paused}
              className="btn-secondary flex !min-h-0 flex-1 items-center justify-center gap-1.5 py-2 text-xs"
            />
            <form action={startReviewAction.bind(null, workout.id)} className="flex-1">
              <button type="submit" className="btn-primary w-full !min-h-0 py-2 text-xs">
                Beenden
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
