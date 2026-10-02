'use client';

import { History, RefreshCw } from 'lucide-react';
import { defaultCopyIndex, formatHistoryDate, formatLastResult, setChipLabel, type LastResultState } from '@/lib/exercise-history';
import { isSetBased } from '@/lib/set-form';
import type { ExerciseType } from '@/types/database';

/**
 * "Letztes Mal": a small supporting reference under the exercise name — the user's own
 * most recent completed result, with a button that only FILLS the inputs. Nothing in
 * here saves anything.
 */
export function LastResultBlock({
  type,
  exerciseName,
  state,
  nextSetNumber,
  copiedIndex,
  onCopy,
  onHistory,
  onRetry,
}: {
  type: ExerciseType;
  exerciseName: string;
  state: LastResultState;
  nextSetNumber: number;
  /** The earlier set whose values currently sit unsaved in the inputs. */
  copiedIndex: number | null;
  onCopy: (index: number) => void;
  /** Absent when the history function is not available yet. */
  onHistory?: () => void;
  onRetry: () => void;
}) {
  if (state.status === 'hidden') return null;

  if (state.status === 'none') {
    return <p className="text-xs text-neutral-500">Noch keine früheren Einträge.</p>;
  }

  if (state.status === 'error') {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-neutral-50 px-3 py-2 text-xs text-neutral-500" role="status">
        <span>Frühere Werte konnten nicht geladen werden.</span>
        <button type="button" onClick={onRetry} className="inline-flex min-h-[44px] items-center gap-1.5 font-semibold text-brand">
          <RefreshCw size={13} /> Erneut laden
        </button>
      </div>
    );
  }

  const { entry } = state;
  const summary = formatLastResult(type, exerciseName, entry.sets);
  const many = entry.sets.length > 1;
  const noun = isSetBased(type) ? 'Satz' : 'Eintrag';
  const defaultIndex = defaultCopyIndex(entry.sets.length, nextSetNumber);
  const date = formatHistoryDate(entry.performedAt);

  return (
    <section aria-label="Letztes Mal" className="rounded-xl bg-neutral-50 px-3 pb-1 pt-1">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-xs font-semibold text-neutral-500">Letztes Mal{date ? ` · ${date}` : ''}</p>
        {onHistory && (
          <button
            type="button"
            onClick={onHistory}
            aria-label="Verlauf ansehen"
            className="-mr-2 inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-bold text-neutral-600 active:bg-neutral-150"
          >
            <History size={13} /> Verlauf
          </button>
        )}
      </div>
      <p className="-mt-1.5 break-words text-sm font-semibold text-neutral-900">{summary || '—'}</p>

      <div className="-ml-1.5 flex flex-wrap items-center gap-x-0.5">
        <button
          type="button"
          onClick={() => onCopy(defaultIndex)}
          className="inline-flex min-h-[44px] items-center rounded-lg px-1.5 text-xs font-bold text-brand active:bg-brand/10"
        >
          Werte übernehmen{many ? ` (${noun} ${defaultIndex + 1})` : ''}
        </button>
        {many && (
          <div role="group" aria-label={`Anderen ${noun} übernehmen`} className="flex items-center">
            <span className="px-1 text-[11px] font-semibold text-neutral-500" aria-hidden="true">
              {noun}
            </span>
            {entry.sets.map((set, i) => (
              <button
                key={`${set.set_number}-${i}`}
                type="button"
                onClick={() => onCopy(i)}
                aria-pressed={copiedIndex === i}
                aria-label={`${noun} ${i + 1} übernehmen: ${setChipLabel(type, set)}`}
                className={`inline-flex min-h-[44px] min-w-[36px] items-center justify-center rounded-lg px-1.5 text-xs font-bold ${
                  copiedIndex === i ? 'bg-brand/15 text-brand' : 'text-neutral-600 active:bg-neutral-150'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
