'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { createExerciseAction } from '../actions';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { FormMessage } from '@/components/ui/FormMessage';
import { EXERCISE_TYPE_OPTIONS, MUSCLE_GROUP_OPTIONS } from '@/lib/exercise-types';

export function CustomExerciseForm({ returnTo }: { returnTo: string }) {
  const [state, formAction] = useFormState(createExerciseAction, undefined);
  const [type, setType] = useState('strength');
  const showMuscle = type === 'strength' || type === 'bodyweight' || type === 'mobility';

  return (
    <form action={formAction} className="card flex flex-col gap-4">
      <input type="hidden" name="returnTo" value={returnTo} />

      <div>
        <label className="label" htmlFor="name">Name</label>
        <input id="name" name="name" required minLength={2} maxLength={80} className="input-field" placeholder="z. B. Rudern am Kabelzug" />
      </div>

      <div>
        <label className="label" htmlFor="exerciseType">Kategorie</label>
        <select id="exerciseType" name="exerciseType" value={type} onChange={(e) => setType(e.target.value)} className="input-field truncate">
          {EXERCISE_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-neutral-400">
          {EXERCISE_TYPE_OPTIONS.find((o) => o.value === type)?.hint}
        </p>
      </div>

      {showMuscle && (
        <div>
          <label className="label" htmlFor="muscleGroup">Muskelgruppe</label>
          <select id="muscleGroup" name="muscleGroup" defaultValue="other" className="input-field truncate">
            {MUSCLE_GROUP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="label" htmlFor="equipment">Equipment (optional)</label>
        <input id="equipment" name="equipment" maxLength={80} className="input-field" placeholder="z. B. Kabelzug" />
      </div>

      <div>
        <label className="label" htmlFor="notes">Notizen (optional)</label>
        <textarea id="notes" name="notes" rows={2} maxLength={500} className="input-field" />
      </div>

      <FormMessage error={state?.error} />
      <SubmitButton>Übung speichern</SubmitButton>
    </form>
  );
}
