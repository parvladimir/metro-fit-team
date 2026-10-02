'use client';

import { useFormState } from 'react-dom';
import { proposeDuelAction } from '@/app/(app)/team/duelle/actions';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { FormMessage } from '@/components/ui/FormMessage';
import { DUEL_TARGET_DEFAULT, DUEL_TARGET_MAX, DUEL_TARGET_MIN, trainingDaysLabel, type DuelPerson } from '@/lib/duels';
import { DuelSharingNotes } from './DuelRules';

interface Props {
  teammates: DuelPerson[];
  /** Pre-selected teammate (e.g. "Neu vorschlagen" from the history). */
  defaultInviteeId?: string;
  /** Berlin calendar dates (YYYY-MM-DD), computed on the server so the form never depends on the browser's clock or zone. */
  defaultStart: string;
  minStart: string;
  maxStart: string;
}

export function DuelProposalForm({ teammates, defaultInviteeId, defaultStart, minStart, maxStart }: Props) {
  const [state, formAction] = useFormState(proposeDuelAction, undefined);
  const targets = Array.from({ length: DUEL_TARGET_MAX - DUEL_TARGET_MIN + 1 }, (_, i) => DUEL_TARGET_MIN + i);

  if (teammates.length === 0) {
    return <p className="text-sm text-neutral-500">Dein Team hat noch keine weiteren Mitglieder, die du einladen könntest.</p>;
  }

  return (
    <form action={formAction} className="card flex flex-col gap-3">
      <div className="min-w-0">
        <label className="label text-xs" htmlFor="duel-invitee">Mit wem?</label>
        <select id="duel-invitee" name="inviteeId" required defaultValue={defaultInviteeId ?? ''} className="input-field">
          <option value="" disabled>Teammitglied wählen</option>
          {teammates.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <label className="label text-xs" htmlFor="duel-target">Ziel in 7 Tagen</label>
          <select id="duel-target" name="targetDays" required defaultValue={String(DUEL_TARGET_DEFAULT)} className="input-field">
            {targets.map((n) => (
              <option key={n} value={n}>{trainingDaysLabel(n)}</option>
            ))}
          </select>
        </div>
        <div className="min-w-0">
          <label className="label text-xs" htmlFor="duel-start">Start</label>
          <input id="duel-start" name="startsOn" type="date" required defaultValue={defaultStart} min={minStart} max={maxStart} className="input-field" />
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold text-neutral-700">Das steht in der Einladung und gilt für euch beide:</p>
        <DuelSharingNotes />
      </div>
      <p className="text-[11px] text-neutral-400">
        Die Einladung gilt bis zum Start, höchstens 3 Tage. Der Start liegt immer in der Zukunft; das Ziel lässt sich danach nicht mehr ändern.
      </p>

      <FormMessage error={state?.error} />
      <SubmitButton>Einladung senden</SubmitButton>
    </form>
  );
}
