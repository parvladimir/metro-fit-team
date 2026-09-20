'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Info, Plus, PlusCircle, Target } from 'lucide-react';
import { addExerciseToDayAction } from '@/app/(app)/plan/actions';
import { MUSCLE_GROUP_OPTIONS, exerciseTypeLabel, normalizeExerciseType } from '@/lib/exercise-types';
import { targetFieldsFor, trackingDescription, type TargetFieldKey } from '@/lib/plan-targets';
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
  const [showTargets, setShowTargets] = useState(false);
  const [bwMode, setBwMode] = useState<'reps' | 'duration'>('reps');

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
          onChange={(e) => {
            setExerciseId(e.target.value);
            setShowTargets(false);
            setBwMode('reps');
          }}
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
      </div>

      {selected && (
        <div className="rounded-xl bg-neutral-50 px-3.5 py-3">
          <p className="break-words text-sm font-semibold text-neutral-900">{selected.name}</p>
          <p className="text-xs font-medium text-brand">{exerciseTypeLabel(selected.exercise_type)}</p>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Erfasst im Training</p>
          <p className="break-words text-xs text-neutral-500">{trackingDescription(selected.exercise_type)}</p>
        </div>
      )}

      <Link
        href={`/uebungen/neu?returnTo=${encodeURIComponent(`/plan/tag/${weekday}`)}`}
        className="btn-ghost -mt-1 self-start bg-neutral-150 px-4 text-sm text-brand"
      >
        <PlusCircle size={16} strokeWidth={2} />
        Eigene Übung erstellen
      </Link>

      {selected && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setShowTargets((v) => !v)}
            aria-expanded={showTargets}
            className="btn-ghost flex items-center justify-between bg-neutral-150 px-4 text-sm text-brand"
          >
            <span className="flex items-center gap-2">
              <Target size={16} strokeWidth={2} />
              {showTargets ? 'Ziel (optional)' : 'Ziel festlegen'}
            </span>
            <ChevronDown size={16} className={`transition ${showTargets ? 'rotate-180' : ''}`} />
          </button>

          {showTargets && (
            <div key={selected.id} className="flex flex-col gap-3">
              {normalizeExerciseType(selected.exercise_type) === 'bodyweight' && (
                <>
                  <input type="hidden" name="targetMode" value={bwMode} />
                  <div className="segmented !rounded-xl text-xs">
                    {(['reps', 'duration'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setBwMode(m)}
                        className={`segmented-item !rounded-lg !py-2 !text-xs ${bwMode === m ? 'segmented-item-active' : ''}`}
                      >
                        {m === 'reps' ? 'Wiederholungen' : 'Dauer'}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="flex flex-col gap-3">
                {targetFieldsFor(selected.exercise_type, bwMode).map((key) => (
                  <TargetInput key={key} field={key} bodyweight={normalizeExerciseType(selected.exercise_type) === 'bodyweight'} exercise={selected} />
                ))}
              </div>
              <p className="flex items-start gap-2 text-xs text-neutral-400">
                <Info size={14} className="mt-0.5 shrink-0" />
                Die geplanten Werte dienen nur als Ziel. Die tatsächlichen Werte trägst du während des Trainings ein.
              </p>
            </div>
          )}
        </div>
      )}

      <button type="submit" disabled={!exerciseId} className="btn-primary">
        <Plus size={17} strokeWidth={2.25} />
        Zur Planung hinzufügen
      </button>
    </form>
  );
}

const FIELDS: Record<TargetFieldKey, { name: string; label: string; placeholder: string; mode: 'numeric' | 'decimal' | 'text' }> = {
  sets: { name: 'targetSets', label: 'Ziel-Sätze', placeholder: '3', mode: 'numeric' },
  reps: { name: 'targetReps', label: 'Ziel-Wiederholungen', placeholder: '10', mode: 'numeric' },
  weight: { name: 'targetWeight', label: 'Ziel-Gewicht (kg)', placeholder: '80', mode: 'decimal' },
  duration: { name: 'targetDuration', label: 'Ziel-Dauer / Zeit (mm:ss)', placeholder: '30:00', mode: 'text' },
  distance: { name: 'targetDistance', label: 'Ziel-Distanz (km)', placeholder: '5,0', mode: 'decimal' },
  rounds: { name: 'targetRounds', label: 'Ziel-Runden', placeholder: '8', mode: 'numeric' },
  work: { name: 'targetWork', label: 'Ziel-Belastungszeit (Sek.)', placeholder: '40', mode: 'numeric' },
  rest: { name: 'targetRest', label: 'Ziel-Pause (Sek.)', placeholder: '20', mode: 'numeric' },
};

function TargetInput({ field, bodyweight, exercise }: { field: TargetFieldKey; bodyweight: boolean; exercise: CatalogueExercise }) {
  const f = FIELDS[field];
  const label = field === 'weight' && bodyweight ? 'Zusatzgewicht (kg, optional)' : f.label;
  const defaultValue = field === 'sets' ? exercise.default_sets ?? undefined : field === 'reps' ? exercise.default_reps ?? undefined : undefined;
  return (
    <div className="min-w-0">
      <label className="label" htmlFor={f.name}>{label}</label>
      <input
        id={f.name}
        name={f.name}
        inputMode={f.mode}
        placeholder={f.placeholder}
        defaultValue={defaultValue}
        autoComplete="off"
        className="input-field w-full"
      />
    </div>
  );
}
