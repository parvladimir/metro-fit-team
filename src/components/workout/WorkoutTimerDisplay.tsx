'use client';

import { useElapsedSeconds } from '@/lib/use-elapsed-seconds';
import { formatDuration } from '@/lib/workout-metrics';
import { isLongWorkout, needsGentleReminder } from '@/lib/workout-timer';

/** Live elapsed-time clock for the running-workout screen. Purely a display —
 * the authoritative duration is always computed server-side at finish time.
 * Color shifts at the same two centralized thresholds used for the mandatory
 * finish-time confirmation, so the visual cue foreshadows what's coming. */
export function WorkoutTimerDisplay({
  startedAt,
  pausedSeconds,
  pausedAt,
}: {
  startedAt: string;
  pausedSeconds: number;
  pausedAt: string | null;
}) {
  const elapsed = useElapsedSeconds({ startedAt, pausedSeconds, pausedAt });
  const color = isLongWorkout(elapsed) ? 'text-amber-400' : needsGentleReminder(elapsed) ? 'text-amber-300' : 'text-brand';

  return (
    <div className="card items-center gap-1 !py-5 text-center">
      <p className={`metric-number text-4xl tabular-nums ${color}`}>{formatDuration(elapsed)}</p>
      <p className="text-xs font-semibold text-neutral-400">{pausedAt ? 'Pausiert' : 'Läuft'}</p>
    </div>
  );
}
