'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { ChevronDown, Plus } from 'lucide-react';
import { addSetAction } from '@/app/(app)/aktivitaet/actions';
import { normalizeExerciseType, prefersPace } from '@/lib/exercise-types';
import { formatPace, formatSpeed, paceSecondsPerKm, parseDuration, speedKmh } from '@/lib/workout-metrics';
import type { ExerciseType } from '@/types/database';

function Field({ label, name, unit, placeholder, mode = 'decimal', required }: {
  label: string; name: string; unit?: string; placeholder?: string; mode?: 'decimal' | 'numeric' | 'text'; required?: boolean;
}) {
  return (
    <div className="min-w-0">
      <label className="label text-xs" htmlFor={`f-${name}`}>{label}{unit ? ` (${unit})` : ''}</label>
      <input
        id={`f-${name}`}
        name={name}
        inputMode={mode}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        className="input-field w-full py-2.5 text-sm"
      />
    </div>
  );
}

const GRID = 'grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-3';

function SubmitSet({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary px-4 py-2.5 text-sm">
      <Plus size={16} strokeWidth={2.25} />
      {pending ? 'Speichern…' : label}
    </button>
  );
}

/** Live pace / speed preview for distance cardio. */
function CardioPreview({ name, formRef }: { name: string; formRef: React.RefObject<HTMLFormElement> }) {
  const [text, setText] = useState('');
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const update = () => {
      const d = parseDuration((form.elements.namedItem('duration') as HTMLInputElement)?.value ?? '');
      const km = Number(((form.elements.namedItem('distanceKm') as HTMLInputElement)?.value ?? '').replace(',', '.')) || null;
      const pace = paceSecondsPerKm(d, km);
      const speed = speedKmh(d, km);
      if (!pace || !speed) return setText('');
      setText(prefersPace(name) ? `Pace ${formatPace(pace)} · Ø ${formatSpeed(speed)}` : `Ø ${formatSpeed(speed)} · Pace ${formatPace(pace)}`);
    };
    form.addEventListener('input', update);
    return () => form.removeEventListener('input', update);
  }, [name, formRef]);
  return text ? <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm font-semibold text-brand">{text}</p> : null;
}

export function SetLogger({
  workoutId,
  workoutExerciseId,
  exerciseType,
  exerciseName,
  nextSetNumber,
}: {
  workoutId: string;
  workoutExerciseId: string;
  exerciseType: ExerciseType;
  exerciseName: string;
  nextSetNumber: number;
}) {
  const type = normalizeExerciseType(exerciseType);
  const [state, formAction] = useFormState(addSetAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const [bwMode, setBwMode] = useState<'reps' | 'duration'>('reps');
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setMore(false);
    }
  }, [state]);

  const cta = useMemo(() => (type === 'strength' ? `Satz ${nextSetNumber} speichern` : 'Speichern'), [type, nextSetNumber]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="workoutId" value={workoutId} />
      <input type="hidden" name="workoutExerciseId" value={workoutExerciseId} />

      {type === 'strength' && (
        <div className={GRID}>
          <Field label="Gewicht" name="weight" unit="kg" placeholder="80" required />
          <Field label="Wdh." name="reps" placeholder="10" mode="numeric" required />
        </div>
      )}

      {type === 'bodyweight' && (
        <>
          <div className="flex gap-1 rounded-xl bg-neutral-150 p-1 text-xs font-semibold">
            {(['reps', 'duration'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setBwMode(m)}
                className={`flex-1 rounded-lg py-2 transition ${bwMode === m ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-400'}`}
              >
                {m === 'reps' ? 'Wiederholungen' : 'Dauer'}
              </button>
            ))}
          </div>
          <div className={GRID}>
            {bwMode === 'reps' ? (
              <Field label="Wdh." name="reps" placeholder="10" mode="numeric" required />
            ) : (
              <Field label="Dauer" name="duration" unit="mm:ss" placeholder="01:00" mode="text" required />
            )}
            <Field label="Zusatzgewicht" name="weight" unit="kg" placeholder="optional" />
          </div>
        </>
      )}

      {type === 'cardio_distance' && (
        <>
          <div className={GRID}>
            <Field label="Zeit" name="duration" unit="mm:ss" placeholder="42:30" mode="text" required />
            <Field label="Distanz" name="distanceKm" unit="km" placeholder="8,2" />
          </div>
          <CardioPreview name={exerciseName} formRef={formRef} />
        </>
      )}

      {type === 'interval' && (
        <div className={GRID}>
          <Field label="Runden" name="rounds" placeholder="8" mode="numeric" required />
          <Field label="Belastung" name="workSeconds" unit="Sek." placeholder="40" mode="numeric" required />
          <Field label="Pause" name="intervalRestSeconds" unit="Sek." placeholder="20" mode="numeric" />
        </div>
      )}

      {(type === 'cardio_time' || type === 'mobility' || type === 'sport' || type === 'other') && (
        <div className={GRID}>
          <Field label="Dauer" name="duration" unit="mm:ss" placeholder="30:00" mode="text" required />
        </div>
      )}

      <button
        type="button"
        onClick={() => setMore((v) => !v)}
        className="flex items-center gap-1 self-start text-xs font-semibold text-neutral-400"
        aria-expanded={more}
      >
        <ChevronDown size={14} className={`transition ${more ? 'rotate-180' : ''}`} />
        Weitere Daten
      </button>

      <div className={more ? 'flex flex-col gap-3' : 'hidden'}>
        <div className={GRID}>
          {type === 'strength' && (
            <>
              <Field label="RPE" name="rpe" placeholder="1–10" />
              <Field label="Pause" name="restSeconds" unit="Sek." mode="numeric" />
            </>
          )}
          {type === 'bodyweight' && <Field label="RPE" name="rpe" placeholder="1–10" />}
          {type === 'cardio_distance' && (
            <>
              <Field label="Höhenmeter" name="elevationGainM" unit="m" mode="numeric" />
              <Field label="Steigung" name="inclinePct" unit="%" />
            </>
          )}
          {type !== 'strength' && (
            <>
              <Field label="Kalorien" name="calories" unit="kcal" mode="numeric" />
              <Field label="Ø Puls" name="avgHeartRate" unit="bpm" mode="numeric" />
              <Field label="Max. Puls" name="maxHeartRate" unit="bpm" mode="numeric" />
            </>
          )}
        </div>
        <div className="min-w-0">
          <label className="label text-xs" htmlFor="f-notes">Notiz</label>
          <input id="f-notes" name="notes" maxLength={500} className="input-field w-full py-2.5 text-sm" />
        </div>
      </div>

      {state?.error && <p className="text-sm font-medium text-red-400">{state.error}</p>}
      <SubmitSet label={cta} />
    </form>
  );
}
