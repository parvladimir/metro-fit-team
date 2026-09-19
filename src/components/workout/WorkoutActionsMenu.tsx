'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { MoreHorizontal, Pencil, Trash2, X } from 'lucide-react';
import { deleteWorkoutAction } from '@/app/(app)/aktivitaet/actions';

/** "⋯" button → bottom sheet with Bearbeiten / Löschen, delete needs confirmation.
 * Only rendered for the workout's owner (the page checks; the server enforces). */
export function WorkoutActionsMenu({ workoutId }: { workoutId: string }) {
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove() {
    setError(null);
    start(async () => {
      try {
        await deleteWorkoutAction(workoutId);
      } catch (e) {
        // redirect() throws NEXT_REDIRECT on success; anything else is a real failure
        if (e && typeof e === 'object' && 'digest' in e && String((e as { digest: string }).digest).startsWith('NEXT_REDIRECT')) throw e;
        setError('Training konnte nicht gelöscht werden.');
      }
    });
  }

  return (
    <>
      <button type="button" onClick={() => setSheet(true)} aria-label="Trainingsoptionen" className="btn-icon h-10 w-10 bg-neutral-100 text-neutral-500">
        <MoreHorizontal size={20} />
      </button>

      {sheet && !confirm && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={() => setSheet(false)} role="dialog" aria-modal="true" aria-label="Trainingsoptionen">
          <div
            className="mx-auto w-full max-w-app rounded-t-3xl border-t border-white/10 bg-neutral-100 p-4"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300" />
            <Link href={`/aktivitaet/training/${workoutId}/bearbeiten`} className="flex items-center gap-3 rounded-2xl px-3 py-3.5 text-sm font-semibold text-neutral-900 active:bg-neutral-150">
              <Pencil size={18} className="text-brand" /> Bearbeiten
            </Link>
            <button type="button" onClick={() => setConfirm(true)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3.5 text-left text-sm font-semibold text-red-400 active:bg-red-500/10">
              <Trash2 size={18} /> Löschen
            </button>
            <button type="button" onClick={() => setSheet(false)} className="btn-secondary mt-2 w-full">
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5" role="alertdialog" aria-modal="true" aria-labelledby="del-title">
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-neutral-100 p-5">
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-400">
                <Trash2 size={20} />
              </span>
              <button type="button" onClick={() => { setConfirm(false); setSheet(false); }} aria-label="Schließen" className="btn-icon">
                <X size={18} />
              </button>
            </div>
            <h2 id="del-title" className="mt-3 text-lg font-bold text-neutral-900">Training wirklich löschen?</h2>
            <p className="mt-1.5 text-sm text-neutral-500">Dieses Training wird aus deinem Verlauf und aus der Team-Aktivität entfernt.</p>
            {error && <p className="mt-2 text-sm font-medium text-red-400">{error}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" disabled={pending} onClick={() => { setConfirm(false); setSheet(false); }} className="btn-secondary flex-1">
                Abbrechen
              </button>
              <button type="button" disabled={pending} onClick={remove} className="btn flex-1 bg-red-500 text-white active:bg-red-600">
                {pending ? 'Wird gelöscht…' : 'Training löschen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
