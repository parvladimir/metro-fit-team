'use client';

import { useState, useTransition } from 'react';
import { Trash2, X } from 'lucide-react';
import { discardWorkoutAction } from '@/app/(app)/aktivitaet/actions';
import { clearDraftsForWorkout, unmarkWorkoutEnded } from '@/lib/workout-drafts';

/** "Training verwerfen?" confirmation before discarding a running/paused
 * workout — mirrors WorkoutActionsMenu's own two-step delete confirmation.
 * Never completes silently: a discard always needs this explicit step. */
export function DiscardWorkoutButton({
  workoutId,
  userId,
  className,
  label = 'Verwerfen',
}: {
  workoutId: string;
  /** Lets the on-device set drafts of this workout be dropped with it. */
  userId?: string;
  className?: string;
  label?: string;
}) {
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();

  function discard() {
    start(async () => {
      try {
        if (userId) clearDraftsForWorkout(userId, workoutId);
        await discardWorkoutAction(workoutId);
      } catch (e) {
        // redirect() throws NEXT_REDIRECT on success; anything else is a real failure
        if (e && typeof e === 'object' && 'digest' in e && String((e as { digest: string }).digest).startsWith('NEXT_REDIRECT')) throw e;
        // Discarding failed and the workout goes on: its forms may write their drafts again.
        unmarkWorkoutEnded(workoutId);
      }
    });
  }

  return (
    <>
      <button type="button" onClick={() => setConfirm(true)} className={className ?? 'btn-destructive px-3.5 py-2 text-xs'}>
        {label}
      </button>

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5" role="alertdialog" aria-modal="true" aria-labelledby="discard-title">
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-neutral-100 p-5">
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-400">
                <Trash2 size={20} />
              </span>
              <button type="button" onClick={() => setConfirm(false)} aria-label="Schließen" className="btn-icon">
                <X size={18} />
              </button>
            </div>
            <h2 id="discard-title" className="mt-3 text-lg font-bold text-neutral-900">
              Training verwerfen?
            </h2>
            <p className="mt-1.5 text-sm text-neutral-500">Dieses Training wird nicht als abgeschlossen gespeichert.</p>
            <div className="mt-5 flex gap-2">
              <button type="button" disabled={pending} onClick={() => setConfirm(false)} className="btn-secondary flex-1">
                Abbrechen
              </button>
              <button type="button" disabled={pending} onClick={discard} className="btn flex-1 bg-red-500 text-white active:bg-red-600">
                {pending ? 'Wird verworfen…' : 'Verwerfen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
