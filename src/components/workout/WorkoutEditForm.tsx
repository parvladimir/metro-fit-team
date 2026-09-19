'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { updateWorkoutAction } from '@/app/(app)/aktivitaet/actions';
import { FormMessage } from '@/components/ui/FormMessage';
import { setFieldsFor, type SetField } from '@/lib/set-input';
import { exerciseTypeLabel } from '@/lib/exercise-types';
import type { ExerciseType } from '@/types/database';

export interface EditSet {
  id: string;
  set_number: number;
  weight_kg: number | null;
  reps: number | null;
  distance_km: number | null;
  duration_seconds: number | null;
  metrics: { rounds?: number; work_seconds?: number; interval_rest_seconds?: number };
}
export interface EditExercise {
  id: string;
  name: string;
  type: ExerciseType;
  sets: EditSet[];
}

const LABELS: Record<SetField, { label: string; hint?: string; mode: 'decimal' | 'numeric' | 'text' }> = {
  weight: { label: 'Gewicht (kg)', mode: 'decimal' },
  reps: { label: 'Wdh.', mode: 'numeric' },
  duration: { label: 'Zeit (mm:ss)', mode: 'text' },
  distance: { label: 'Distanz (km)', mode: 'decimal' },
  rounds: { label: 'Runden', mode: 'numeric' },
  work: { label: 'Belastung (Sek.)', mode: 'numeric' },
  rest: { label: 'Pause (Sek.)', mode: 'numeric' },
};

function fmtDuration(s: number | null): string {
  if (s == null) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function initial(field: SetField, s: EditSet): string {
  switch (field) {
    case 'weight': return s.weight_kg != null ? String(s.weight_kg) : '';
    case 'reps': return s.reps != null ? String(s.reps) : '';
    case 'duration': return fmtDuration(s.duration_seconds);
    case 'distance': return s.distance_km != null ? String(s.distance_km) : '';
    case 'rounds': return s.metrics.rounds != null ? String(s.metrics.rounds) : '';
    case 'work': return s.metrics.work_seconds != null ? String(s.metrics.work_seconds) : '';
    case 'rest': return s.metrics.interval_rest_seconds != null ? String(s.metrics.interval_rest_seconds) : '';
  }
}

function Save() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary w-full">
      {pending ? 'Speichern…' : 'Änderungen speichern'}
    </button>
  );
}

export function WorkoutEditForm({
  workoutId,
  title,
  date,
  duration,
  notes,
  showDistance,
  distanceKm,
  exercises,
}: {
  workoutId: string;
  title: string;
  date: string;
  duration: string;
  notes: string;
  showDistance: boolean;
  distanceKm: number | null;
  exercises: EditExercise[];
}) {
  const [state, action] = useFormState(updateWorkoutAction, undefined);
  const hasSetDistance = exercises.some((e) => e.sets.some((s) => s.distance_km != null));

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="workoutId" value={workoutId} />

      <section className="card flex flex-col gap-3">
        <div>
          <label className="label" htmlFor="title">Titel</label>
          <input id="title" name="title" defaultValue={title} maxLength={120} className="input-field" />
        </div>
        <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
          <div className="min-w-0">
            <label className="label" htmlFor="date">Datum</label>
            <input id="date" name="date" type="date" defaultValue={date} required className="input-field" />
          </div>
          <div className="min-w-0">
            <label className="label" htmlFor="duration">Dauer (mm:ss)</label>
            <input id="duration" name="duration" defaultValue={duration} required inputMode="text" placeholder="45:00" className="input-field" />
          </div>
        </div>
        {showDistance && !hasSetDistance && (
          <div>
            <label className="label" htmlFor="distanceKm">Distanz (km)</label>
            <input id="distanceKm" name="distanceKm" defaultValue={distanceKm ?? ''} inputMode="decimal" className="input-field" />
          </div>
        )}
        <div>
          <label className="label" htmlFor="notes">Notizen</label>
          <textarea id="notes" name="notes" defaultValue={notes} rows={2} maxLength={500} className="input-field" />
        </div>
      </section>

      {exercises.map((ex) => {
        const fields = setFieldsFor(ex.type);
        return (
          <section key={ex.id} className="card flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words text-sm font-bold text-neutral-900">{ex.name}</p>
                <p className="text-xs text-neutral-400">{exerciseTypeLabel(ex.type)}</p>
              </div>
              <label className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-red-400">
                <input type="checkbox" name={`ex-${ex.id}-remove`} className="h-4 w-4 accent-red-500" />
                Übung entfernen
              </label>
            </div>
            {ex.sets.length === 0 && <p className="text-xs text-neutral-400">Keine Einträge.</p>}
            {ex.sets.map((s, i) => (
              <div key={s.id} className="rounded-2xl bg-neutral-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold text-neutral-500">Eintrag {i + 1}</p>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-red-400">
                    <input type="checkbox" name={`set-${s.id}-remove`} className="h-4 w-4 accent-red-500" />
                    Entfernen
                  </label>
                </div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-2.5">
                  {fields.map((f) => (
                    <div key={f} className="min-w-0">
                      <label className="label text-xs" htmlFor={`set-${s.id}-${f}`}>{LABELS[f].label}</label>
                      <input
                        id={`set-${s.id}-${f}`}
                        name={`set-${s.id}-${f}`}
                        defaultValue={initial(f, s)}
                        inputMode={LABELS[f].mode}
                        autoComplete="off"
                        className="input-field w-full py-2.5 text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        );
      })}

      <p className="text-xs text-neutral-400">
        Punkte, Ranking, Wochenziel und Herausforderungen werden nach dem Speichern automatisch neu berechnet.
      </p>
      <FormMessage error={state?.error} />
      <Save />
    </form>
  );
}
