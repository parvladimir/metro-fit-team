'use client';

import { useRef, useState, useTransition } from 'react';
import { ArrowLeft, Info } from 'lucide-react';
import { ExercisePicker, type PickerExercise, type PickerFavorites } from '@/components/exercises/ExercisePicker';
import { Sheet } from '@/components/ui/Sheet';
import { replaceExerciseAction, type ReplaceExerciseResult } from '@/app/(app)/aktivitaet/workout-exercise-actions';
import { newUuid } from '@/lib/uuid';

export interface ReplaceTarget {
  id: string;
  exerciseId: string;
  name: string;
  hasSets: boolean;
}

/**
 * "Übung ersetzen" for the running workout: pick another exercise, see exactly what will
 * happen, confirm. The change applies to this workout only — the weekly plan and saved
 * templates are never touched, and sets that were already recorded stay with the
 * exercise they were recorded for.
 */
export function ReplaceExerciseSheet({
  workoutId,
  target,
  catalogue,
  hasUnsavedInput,
  createHref,
  favorites,
  recentIds,
  onClose,
  onDone,
  onRefused,
}: {
  workoutId: string;
  target: ReplaceTarget;
  catalogue: PickerExercise[];
  /** Typed but unsaved input exists for the exercise that would be replaced. */
  hasUnsavedInput: boolean;
  createHref: string;
  favorites: PickerFavorites | null;
  recentIds: readonly string[] | null;
  onClose: () => void;
  onDone: (result: Extract<ReplaceExerciseResult, { ok: true }>, replacement: PickerExercise) => void;
  /** The server refused the change (e.g. the workout was finished meanwhile): the screen may be out of date. */
  onRefused?: () => void;
}) {
  const [selected, setSelected] = useState<PickerExercise | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The id of the new exercise row doubles as the request id: a repeated tap or a retry after a lost
  // response is answered as already done instead of being applied twice.
  const requestId = useRef(newUuid());

  function pick(exercise: PickerExercise) {
    setSelected(exercise);
    setError(null);
    requestId.current = newUuid();
  }

  function confirm() {
    if (!selected || pending) return;
    setError(null);
    const replacement = selected;
    startTransition(async () => {
      try {
        const res = await replaceExerciseAction({
          workoutId,
          workoutExerciseId: target.id,
          newExerciseId: replacement.id,
          requestId: requestId.current,
        });
        if (!res.ok) {
          setError(res.error);
          onRefused?.();
          return;
        }
        onDone(res, replacement);
      } catch {
        setError('Keine Verbindung – die Änderung wurde möglicherweise nicht gespeichert. Du kannst es erneut versuchen, doppeltes Ersetzen wird verhindert.');
      }
    });
  }

  const keepsOriginal = target.hasSets;

  return (
    <Sheet title="Übung ersetzen" onClose={onClose}>
      <p className="mb-3 flex items-start gap-2 rounded-xl bg-neutral-50 px-3 py-2.5 text-xs text-neutral-500">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>Die Änderung gilt nur für dieses Training. Dein Plan und deine Vorlage bleiben unverändert.</span>
      </p>

      {!selected ? (
        <>
          <p className="mb-2 text-sm text-neutral-600">
            Statt <span className="font-semibold text-neutral-900">{target.name}</span>:
          </p>
          <ExercisePicker items={catalogue} disabledId={target.exerciseId} onPick={pick} createHref={createHref} favorites={favorites} recentIds={recentIds} />
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="rounded-2xl bg-neutral-50 p-3">
            <p className="break-words text-sm font-bold text-neutral-900">{selected.name}</p>
            <p className="mt-0.5 break-words text-xs text-neutral-500">statt {target.name}</p>
          </div>

          {keepsOriginal ? (
            <p className="text-sm text-neutral-700">
              Bereits erfasste Sätze bleiben bei {target.name}. Für weitere Sätze wird {selected.name} hinzugefügt.
            </p>
          ) : (
            <p className="text-sm text-neutral-700">
              {selected.name} übernimmt den Platz von {target.name}. Es sind noch keine Sätze erfasst.
            </p>
          )}

          {!keepsOriginal && hasUnsavedInput && (
            <p className="rounded-xl border border-amber-400/40 bg-amber-400/[0.06] px-3 py-2 text-sm text-neutral-800" role="status">
              Deine nicht gespeicherten Eingaben bei {target.name} gehen dabei verloren.
            </p>
          )}

          {error && (
            <p className="text-sm font-medium text-red-400" role="alert">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button type="button" disabled={pending} onClick={() => setSelected(null)} className="btn-secondary min-h-[44px] flex-1 text-sm">
              <ArrowLeft size={15} /> Zurück
            </button>
            <button type="button" disabled={pending} onClick={confirm} className="btn-primary min-h-[44px] flex-1 text-sm">
              {pending ? 'Einen Moment…' : keepsOriginal ? 'Hinzufügen' : 'Ersetzen'}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
