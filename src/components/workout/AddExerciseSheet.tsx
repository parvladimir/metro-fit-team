'use client';

import { useRef, useState, useTransition } from 'react';
import { ExercisePicker, type PickerExercise, type PickerFavorites } from '@/components/exercises/ExercisePicker';
import { Sheet } from '@/components/ui/Sheet';
import { addExerciseToWorkoutAction, type AddExerciseResult } from '@/app/(app)/aktivitaet/exercise-library-actions';
import { newUuid } from '@/lib/uuid';

/** "Übung hinzufügen": the same picker as "Übung ersetzen" (Favoriten · Zuletzt · Alle + search). Tapping an
 * exercise appends it to the END of the running workout; nothing is logged for it. */
export function AddExerciseSheet({
  workoutId,
  catalogue,
  favorites,
  recentIds,
  createHref,
  onClose,
  onDone,
}: {
  workoutId: string;
  catalogue: PickerExercise[];
  favorites: PickerFavorites | null;
  recentIds: readonly string[] | null;
  createHref: string;
  onClose: () => void;
  onDone: (result: Extract<AddExerciseResult, { ok: true }>, exercise: PickerExercise) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The id of the new exercise row doubles as the request id: a second tap or a retry after a lost response is
  // answered as already done instead of adding the exercise twice. It changes only after a confirmed add.
  const requestId = useRef(newUuid());
  const lastPick = useRef<string | null>(null);

  function pick(exercise: PickerExercise) {
    if (pending) return;
    setError(null);
    // A retry of the same choice keeps its id; choosing a different exercise is a different request.
    if (lastPick.current !== exercise.id) {
      requestId.current = newUuid();
      lastPick.current = exercise.id;
    }
    const id = requestId.current;
    startTransition(async () => {
      try {
        const res = await addExerciseToWorkoutAction({ workoutId, exerciseId: exercise.id, requestId: id });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        requestId.current = newUuid();
        lastPick.current = null;
        onDone(res, exercise);
      } catch {
        setError('Keine Verbindung – die Übung wurde möglicherweise nicht hinzugefügt. Du kannst es erneut versuchen, doppeltes Hinzufügen wird verhindert.');
      }
    });
  }

  return (
    <Sheet title="Übung hinzufügen" onClose={onClose}>
      <p className="mb-3 text-xs text-neutral-500">Die Übung wird am Ende dieses Trainings eingefügt. Es wird nichts automatisch erfasst.</p>
      {error && (
        <p className="mb-3 text-sm font-medium text-red-400" role="alert">
          {error}
        </p>
      )}
      <div aria-busy={pending} className={pending ? 'pointer-events-none opacity-60' : ''}>
        <ExercisePicker items={catalogue} onPick={pick} createHref={createHref} favorites={favorites} recentIds={recentIds} />
      </div>
    </Sheet>
  );
}
