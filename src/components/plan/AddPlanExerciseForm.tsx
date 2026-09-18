'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, PlusCircle } from 'lucide-react';
import { addExerciseToDayAction } from '@/app/(app)/plan/actions';
import { MUSCLE_GROUP_OPTIONS, exerciseTypeLabel, usesSetTargets } from '@/lib/exercise-types';
import type { Exercise } from '@/types/database';

type CatalogueExercise = Pick<Exercise, 'id' | 'name' | 'exercise_type' | 'muscle_group' | 'is_custom' | 'default_sets' | 'default_reps'>;

export function AddPlanExerciseForm({
  weekday,
  dayTitle,
  catalogue,
  defaultExerciseId,
}: {
  weekday: number;
  dayTitle: string;
  catalogue: CatalogueExercise[];
  defaultExerciseId?: string;
}) {
  const initial = catalogue.find((e) => e.id === defaultExerciseId) ?? null;
  const [exerciseId, setExerciseId] = useState(initial?.id ?? '');
  const selected = catalogue.find((e) => e.id === exerciseId) ?? null;

  const { mine, groups } = useMemo(() => {
    const mineList = catalogue.filter((e) => e.is_custom);
    const byGroup = MUSCLE_GROUP_OPTIONS.map((g) => ({
      label: g.label,
      items: catalogue.filter((e) => !e.is_custom && e.muscle_group === g.value),
    })).filter((g) => g.items.length > 0);
    return { mine: mineList, groups: byGroup };
  }, [catalogue]);

  return (
    <form action={addExerciseToDayAction} className="card flex flex-col gap-4">
      <input type="hidden" name="weekday" value={weekday} />
      <input type="hidden" name="title" value={dayTitle} />

      <p className="text-sm font-semibold text-neutral-800">Übung hinzufügen</p>

      <div className="min-w-0">
        <label className="label" htmlFor="exerciseId">Übungskatalog</label>
        <select
          id="exerciseId"
          name="exerciseId"
          required
          value={exerciseId}
          onChange={(e) => setExerciseId(e.target.value)}
          className="input-field block w-full min-w-0 truncate"
        >
          <option value="" disabled>Übung auswählen…</option>
          {mine.length > 0 && (
            <optgroup label="Meine Übungen">
              {mine.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </optgroup>
          )}
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.items.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
        {selected && <p className="mt-1.5 text-xs text-neutral-400">{exerciseTypeLabel(selected.exercise_type)}</p>}
      </div>

      <Link
        href={`/uebungen/neu?returnTo=${encodeURIComponent(`/plan/tag/${weekday}`)}`}
        className="btn-ghost -mt-1 self-start bg-neutral-150 px-4 text-sm text-brand"
      >
        <PlusCircle size={16} strokeWidth={2} />
        Eigene Übung erstellen
      </Link>

      {selected && usesSetTargets(selected.exercise_type) && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-3">
          <div className="min-w-0">
            <label className="label" htmlFor="targetSets">Sätze</label>
            <input id="targetSets" name="targetSets" type="number" inputMode="numeric" defaultValue={selected.default_sets ?? 3} min={1} max={20} className="input-field" />
          </div>
          <div className="min-w-0">
            <label className="label" htmlFor="targetReps">Wdh. pro Satz</label>
            <input id="targetReps" name="targetReps" type="number" inputMode="numeric" defaultValue={selected.default_reps ?? 10} min={1} max={500} className="input-field" />
          </div>
        </div>
      )}

      <button type="submit" disabled={!exerciseId} className="btn-primary">
        <Plus size={17} strokeWidth={2.25} />
        Zur Planung hinzufügen
      </button>
    </form>
  );
}
