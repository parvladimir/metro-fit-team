import { useEffect, useState } from 'react';
import { computeElapsedSeconds } from '@/lib/workout-timer';

/** Live elapsed seconds for a running/paused workout. Always re-derived from
 * the persisted started_at/paused_seconds/paused_at every tick — never an
 * accumulated client counter — so a reload, backgrounded app or device sleep
 * can never lose or invent elapsed time. Stops ticking while paused, since
 * the value can't change until resumed. */
export function useElapsedSeconds(params: { startedAt: string; pausedSeconds: number; pausedAt: string | null }): number {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (params.pausedAt) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [params.pausedAt]);

  return computeElapsedSeconds({ ...params, now });
}
