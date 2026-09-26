'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle } from 'lucide-react';
import { startReviewAction } from '@/app/(app)/aktivitaet/actions';
import { DiscardWorkoutButton } from '@/components/workout/DiscardWorkoutButton';
import { useElapsedSeconds } from '@/lib/use-elapsed-seconds';
import { needsGentleReminder } from '@/lib/workout-timer';

/** Combines the gentle 120-minute reminder with the "did you forget this
 * running session?" prompt — the running screen is "returned to" every time
 * it's viewed, whether that's a live glance or reopening after hours, and
 * there's no separate signal to tell those apart, so one banner serves both.
 * Never infers a finish time on the user's behalf — "Zeit korrigieren" always
 * opens the normal review screen with blank/frozen defaults for the user to
 * fill in themselves. */
export function StaleSessionBanner({
  workoutId,
  startedAt,
  pausedSeconds,
  pausedAt,
}: {
  workoutId: string;
  startedAt: string;
  pausedSeconds: number;
  pausedAt: string | null;
}) {
  const elapsed = useElapsedSeconds({ startedAt, pausedSeconds, pausedAt });
  const [dismissed, setDismissed] = useState(false);
  const [pending, start] = useTransition();

  if (dismissed || !needsGentleReminder(elapsed)) return null;

  function correctAndFinish() {
    start(async () => {
      try {
        await startReviewAction(workoutId);
      } catch (e) {
        if (e && typeof e === 'object' && 'digest' in e && String((e as { digest: string }).digest).startsWith('NEXT_REDIRECT')) throw e;
      }
    });
  }

  return (
    <div className="card flex flex-col gap-3 border-2 border-amber-400/40 bg-amber-400/[0.06] !p-4">
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-400" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-neutral-900">Läuft dein Training noch?</p>
          <p className="mt-0.5 text-xs text-neutral-500">Dein Timer läuft schon eine Weile. Vielleicht hast du vergessen, ihn zu beenden.</p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <button type="button" onClick={() => setDismissed(true)} className="btn-secondary w-full text-sm">
          Ja, weitertrainieren
        </button>
        <button type="button" disabled={pending} onClick={correctAndFinish} className="btn-secondary w-full text-sm">
          Schon beendet – Zeit korrigieren
        </button>
        <DiscardWorkoutButton workoutId={workoutId} label="Nur getestet – verwerfen" className="btn-ghost w-full text-sm text-red-400" />
      </div>
    </div>
  );
}
