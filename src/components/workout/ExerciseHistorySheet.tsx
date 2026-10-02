'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { loadExerciseHistoryAction } from '@/app/(app)/aktivitaet/workout-exercise-actions';
import { formatChatDayLabel } from '@/lib/date';
import type { HistoryEntry } from '@/lib/exercise-history';
import { summarizeSet } from '@/lib/workout-metrics';
import type { ExerciseType } from '@/types/database';

/** The last few completed sessions of one exercise — the user's own, loaded only when asked for. */
export function ExerciseHistorySheet({
  exerciseId,
  exerciseName,
  exerciseType,
  workoutId,
  onClose,
}: {
  exerciseId: string;
  exerciseName: string;
  exerciseType: ExerciseType;
  workoutId: string;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  // Only the newest request may change what is shown (a slow answer must not replace a newer one).
  const requestRef = useRef(0);

  const load = useCallback(
    async (before: string | null) => {
      const request = ++requestRef.current;
      if (before) setLoadingMore(true);
      else setStatus('loading');
      setMoreFailed(false);
      try {
        const res = await loadExerciseHistoryAction({ exerciseId, excludeWorkoutId: workoutId, before });
        if (request !== requestRef.current) return;
        if (!res.ok) {
          setStatus(before ? 'ok' : 'error');
          if (before) setMoreFailed(true);
          return;
        }
        setEntries((prev) => (before ? [...prev, ...res.entries] : res.entries));
        setHasMore(res.hasMore);
        setStatus('ok');
      } catch {
        if (request === requestRef.current) {
          if (before) setMoreFailed(true);
          else setStatus('error');
        }
      } finally {
        if (request === requestRef.current) setLoadingMore(false);
      }
    },
    [exerciseId, workoutId],
  );

  useEffect(() => {
    void load(null);
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  return (
    <Sheet title={`Verlauf · ${exerciseName}`} onClose={onClose}>
      <p className="mb-3 text-xs text-neutral-500">Frühere Werte dienen als Orientierung.</p>

      {status === 'loading' && (
        <p className="py-6 text-center text-sm text-neutral-500" role="status" aria-busy="true">
          Wird geladen…
        </p>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center gap-3 py-6 text-center" role="alert">
          <p className="text-sm text-neutral-600">Der Verlauf konnte nicht geladen werden.</p>
          <button type="button" onClick={() => void load(null)} className="btn-secondary min-h-[44px] px-4 text-sm">
            <RefreshCw size={15} /> Erneut versuchen
          </button>
        </div>
      )}

      {status === 'ok' && entries.length === 0 && <p className="py-6 text-center text-sm text-neutral-500">Noch keine früheren Einträge.</p>}

      {status === 'ok' && entries.length > 0 && (
        <ol className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li key={entry.workoutExerciseId} className="rounded-2xl bg-neutral-50 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-bold text-neutral-900">
                  {formatChatDayLabel(new Date(entry.performedAt))}
                  {entry.instanceCount > 1 && <span className="ml-2 text-xs font-medium text-neutral-500">Block {entry.instanceNo} von {entry.instanceCount}</span>}
                </p>
                <Link href={`/aktivitaet/training/${entry.workoutId}/zusammenfassung`} className="shrink-0 text-xs font-semibold text-brand">
                  Training ansehen
                </Link>
              </div>
              <ul className="mt-2 flex flex-col gap-1">
                {entry.sets.map((set, i) => (
                  <li key={`${set.set_number}-${i}`} className="flex gap-2 text-sm">
                    <span className="w-5 shrink-0 text-neutral-500">{i + 1}.</span>
                    <span className="min-w-0 break-words font-medium text-neutral-800">{summarizeSet(exerciseType, set)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}

      {status === 'ok' && moreFailed && (
        <p className="mt-3 text-center text-sm text-neutral-500" role="alert">
          Ältere Einträge konnten nicht geladen werden.
        </p>
      )}

      {status === 'ok' && hasMore && (
        <button
          type="button"
          disabled={loadingMore}
          onClick={() => void load(entries[entries.length - 1]?.performedAt ?? null)}
          className="btn-secondary mt-3 min-h-[44px] w-full text-sm"
        >
          {loadingMore ? 'Wird geladen…' : moreFailed ? 'Erneut versuchen' : 'Ältere Einträge laden'}
        </button>
      )}
    </Sheet>
  );
}
