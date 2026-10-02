'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { finishWorkoutAction } from '@/app/(app)/aktivitaet/actions';
import { DiscardWorkoutButton } from '@/components/workout/DiscardWorkoutButton';
import { FormMessage } from '@/components/ui/FormMessage';
import { formatDuration, formatDurationWords } from '@/lib/workout-metrics';

function Save() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary w-full">
      {pending ? 'Speichern…' : 'Speichern'}
    </button>
  );
}

/** Stop first, review second, save last: rendered only once the workout is
 * already paused (frozen), so the duration shown here cannot grow no matter
 * how long this screen stays open. Duration/end-time are pre-filled from that
 * frozen state but always editable ("Dauer korrigieren" / "Endzeit
 * korrigieren"). The >=180min confirmation is never guessed client-side —
 * this only reacts to the server's confirmation_required response, which is
 * re-checked there regardless of what this form already showed.
 *
 * "Ja, Dauer stimmt" carries confirmLong=true via its own name/value as the
 * submitting button — standard multi-submit-button HTML semantics, not React
 * state — so there is no risk of a stale confirmation surviving a duration
 * the user has since edited: the plain "Speichern" button never sends it. */
export function ReviewWorkoutForm({
  userId,
  workoutId,
  defaultDurationSeconds,
  defaultTime,
  pausedSeconds,
  showDistance,
}: {
  /** Lets the on-device set drafts of this workout be dropped when it is discarded. */
  userId?: string;
  workoutId: string;
  defaultDurationSeconds: number;
  defaultTime: string;
  pausedSeconds: number;
  showDistance: boolean;
}) {
  const [state, action] = useFormState(finishWorkoutAction, undefined);

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="workoutId" value={workoutId} />

        <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
          <div>
            <label className="label" htmlFor="duration">Dauer korrigieren (mm:ss)</label>
            <input id="duration" name="duration" defaultValue={formatDuration(defaultDurationSeconds)} required inputMode="text" className="input-field" />
          </div>
          <div>
            <label className="label" htmlFor="finishedAtTime">Endzeit korrigieren</label>
            <input id="finishedAtTime" name="finishedAtTime" type="time" defaultValue={defaultTime} required className="input-field" />
          </div>
        </div>

        {pausedSeconds > 0 && <p className="text-xs text-neutral-400">Davon pausiert: {formatDurationWords(pausedSeconds)}</p>}

        {showDistance && (
          <div>
            <label className="label" htmlFor="distanceKm">Distanz (km)</label>
            <input id="distanceKm" name="distanceKm" type="number" step="0.1" inputMode="decimal" className="input-field" />
          </div>
        )}

        <div>
          <label className="label" htmlFor="notes">Notizen</label>
          <textarea id="notes" name="notes" rows={3} className="input-field" />
        </div>

        {state?.confirmRequired && (
          <div className="card flex flex-col gap-3 border-2 border-amber-400/40 bg-amber-400/[0.06] !p-4">
            <p className="text-sm font-bold text-neutral-900">Dein Timer zeigt eine lange Dauer. Ist das richtig?</p>
            <p className="text-xs text-neutral-500">Vielleicht lief der Timer nach dem Training weiter. Bitte prüfe die Dauer vor dem Speichern.</p>
            <div className="flex flex-col gap-2">
              <label htmlFor="duration" className="btn-secondary w-full cursor-pointer text-center text-sm">
                Dauer korrigieren
              </label>
              <button type="submit" name="confirmLong" value="true" className="btn-ghost w-full text-sm">
                Ja, Dauer stimmt
              </button>
            </div>
          </div>
        )}

        <FormMessage error={state?.error} />
        <Save />
      </form>

      <DiscardWorkoutButton workoutId={workoutId} userId={userId} label="Training verwerfen" className="btn-ghost w-full text-sm text-red-400" />
    </div>
  );
}
