'use client';

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, PlusCircle, Search } from 'lucide-react';
import { MUSCLE_GROUP_OPTIONS, exerciseTypeLabel } from '@/lib/exercise-types';
import type { Exercise } from '@/types/database';

export type PickerExercise = Pick<Exercise, 'id' | 'name' | 'exercise_type' | 'muscle_group' | 'is_custom'>;

/** Case- and umlaut-insensitive: "bankdr" finds "Bankdrücken". */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function filterExercises(items: PickerExercise[], query: string): PickerExercise[] {
  const q = normalizeSearch(query);
  if (!q) return items;
  return items.filter((e) => normalizeSearch(e.name).includes(q));
}

function Row({ exercise, disabled, onPick }: { exercise: PickerExercise; disabled: boolean; onPick: (e: PickerExercise) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(exercise)}
        disabled={disabled}
        className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition active:bg-neutral-150 disabled:opacity-40"
      >
        <span className="min-w-0">
          <span className="block break-words text-sm font-semibold text-neutral-900">{exercise.name}</span>
          <span className="block text-xs text-neutral-500">{exerciseTypeLabel(exercise.exercise_type)}</span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-neutral-400" />
      </button>
    </li>
  );
}

/** Search + the exercises the user may use, "Meine Übungen" first, then by muscle group.
 * The caller decides what picking does. */
export function ExercisePicker({
  items,
  disabledId,
  onPick,
  createHref,
}: {
  items: PickerExercise[];
  /** An exercise that cannot be chosen (e.g. the one being replaced). */
  disabledId?: string;
  onPick: (exercise: PickerExercise) => void;
  /** Link to the existing "Eigene Übung erstellen" flow. */
  createHref?: string;
}) {
  const [query, setQuery] = useState('');
  const searchId = useId();

  const matches = useMemo(() => filterExercises(items, query), [items, query]);
  const searching = query.trim() !== '';
  const groups = useMemo(() => {
    const mine = matches.filter((e) => e.is_custom);
    const out: { label: string; items: PickerExercise[] }[] = [];
    if (mine.length) out.push({ label: 'Meine Übungen', items: mine });
    for (const g of MUSCLE_GROUP_OPTIONS) {
      const list = matches.filter((e) => !e.is_custom && e.muscle_group === g.value);
      if (list.length) out.push({ label: g.label, items: list });
    }
    return out;
  }, [matches]);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label htmlFor={searchId} className="sr-only">
          Übung suchen
        </label>
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            id={searchId}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Übung suchen…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="input-field w-full !pl-10"
          />
        </div>
      </div>

      {matches.length === 0 ? (
        <p className="py-3 text-center text-sm text-neutral-500" role="status">
          Keine Übung gefunden.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              {!searching || groups.length > 1 ? <p className="section-title px-3 pb-1">{g.label}</p> : null}
              <ul className="flex flex-col">
                {g.items.map((e) => (
                  <Row key={e.id} exercise={e} disabled={e.id === disabledId} onPick={onPick} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {createHref && (
        <Link href={createHref} className="btn-ghost min-h-[44px] self-start px-4 text-sm text-brand">
          <PlusCircle size={16} strokeWidth={2} />
          Eigene Übung erstellen
        </Link>
      )}
    </div>
  );
}
