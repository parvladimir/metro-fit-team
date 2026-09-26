'use client';

import { useState, useTransition } from 'react';
import { Pause, Play } from 'lucide-react';
import { pauseWorkoutAction, resumeWorkoutAction } from '@/app/(app)/aktivitaet/actions';

/** Explicit pause/resume control for a running workout. Server-authoritative:
 * the button reflects the `paused` prop from the server, never a local guess,
 * and shows a real error rather than pretending a rejected request saved. */
export function PauseResumeButton({ workoutId, paused, className }: { workoutId: string; paused: boolean; className?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setError(null);
    start(async () => {
      try {
        if (paused) await resumeWorkoutAction(workoutId);
        else await pauseWorkoutAction(workoutId);
      } catch {
        setError(paused ? 'Konnte nicht fortgesetzt werden.' : 'Pause konnte nicht gespeichert werden.');
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button type="button" disabled={pending} onClick={toggle} className={className ?? 'btn-secondary flex flex-1 items-center justify-center gap-1.5'}>
        {paused ? <Play size={16} strokeWidth={2.25} /> : <Pause size={16} strokeWidth={2.25} />}
        {paused ? 'Fortsetzen' : 'Pause'}
      </button>
      {error && <p className="text-center text-xs font-medium text-red-400">{error}</p>}
    </div>
  );
}
