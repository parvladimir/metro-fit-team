'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { createTrainingInviteAction, updateTrainingInviteAction, type TrainingFormState } from '@/app/(app)/team/training/actions';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { FormMessage } from '@/components/ui/FormMessage';
import { TRAINING_INVITE_ACTIVITY_TYPES, TRAINING_INVITE_LIMITS } from '@/lib/training-invites';
import { t } from '@/lib/i18n';

interface Props {
  mode: 'create' | 'edit';
  /** Generated when the page renders and posted back: the idempotency key (create) or the invitation being edited (edit). */
  inviteId: string;
  shares: { id: string; title: string }[];
  /** "YYYY-MM-DDTHH:MM" in Berlin time — the earliest selectable moment. */
  minStartsAt: string;
  initial: {
    title: string;
    startsAt: string;
    activityType: string;
    planShareId: string;
    place: string;
    note: string;
  };
}

/** Create / edit form for a "Wer ist dabei?" card. The time is read as Berlin
 * wall-clock time on the server; if it falls into the skipped or repeated hour
 * of a clock change the server answers with a question instead of guessing,
 * rendered here as two buttons that resubmit with the chosen reading. */
export function TrainingInviteForm({ mode, inviteId, shares, minStartsAt, initial }: Props) {
  const [state, formAction] = useFormState<TrainingFormState | undefined, FormData>(
    mode === 'create' ? createTrainingInviteAction : updateTrainingInviteAction,
    undefined,
  );
  const [startsAt, setStartsAt] = useState(initial.startsAt);
  // Only show the question while the field still holds the value it was asked about.
  const check = state?.timeCheck && state.timeCheck.forValue === startsAt ? state.timeCheck : null;

  return (
    <form action={formAction} className="card flex flex-col gap-3">
      <input type="hidden" name="inviteId" value={inviteId} />

      <div className="min-w-0">
        <label className="label text-xs" htmlFor="ti-title">Titel</label>
        <input id="ti-title" name="title" required maxLength={TRAINING_INVITE_LIMITS.title} defaultValue={initial.title} placeholder="z. B. Beine & Rücken" className="input-field" autoComplete="off" />
      </div>

      <div className="min-w-0">
        <label className="label text-xs" htmlFor="ti-start">Wann? (Berliner Zeit)</label>
        <input
          id="ti-start"
          name="startsAt"
          type="datetime-local"
          required
          min={minStartsAt}
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
          className="input-field"
          aria-describedby={check ? 'ti-timecheck' : undefined}
        />
      </div>

      {check && (
        <div id="ti-timecheck" role="alert" className="flex flex-col gap-2 rounded-xl border border-accent-warning/40 bg-accent-warning/10 px-3 py-3">
          <p className="text-sm font-medium text-neutral-900">{check.message}</p>
          <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
            {check.choices.map((c) => (
              <button key={c.value} type="submit" name="timeChoice" value={c.value} className="btn-secondary w-full text-sm">
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
        <div className="min-w-0">
          <label className="label text-xs" htmlFor="ti-type">Trainingsart (optional)</label>
          <select id="ti-type" name="activityType" defaultValue={initial.activityType} className="input-field">
            <option value="">Keine Angabe</option>
            {TRAINING_INVITE_ACTIVITY_TYPES.map((type) => (
              <option key={type} value={type}>{t(`activityType.${type}` as Parameters<typeof t>[0])}</option>
            ))}
          </select>
        </div>
        <div className="min-w-0">
          <label className="label text-xs" htmlFor="ti-share">Geteilte Vorlage (optional)</label>
          <select id="ti-share" name="planShareId" defaultValue={initial.planShareId} className="input-field">
            <option value="">Keine</option>
            {shares.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="min-w-0">
        <label className="label text-xs" htmlFor="ti-place">Treffpunkt (optional)</label>
        <input id="ti-place" name="place" maxLength={TRAINING_INVITE_LIMITS.place} defaultValue={initial.place} placeholder="z. B. Eingang Studio" className="input-field" autoComplete="off" />
        <p className="mt-1 text-[11px] text-neutral-400">Nur ein Text — es wird kein Standort erfasst.</p>
      </div>

      <div className="min-w-0">
        <label className="label text-xs" htmlFor="ti-note">Notiz (optional)</label>
        <textarea id="ti-note" name="note" rows={2} maxLength={TRAINING_INVITE_LIMITS.note} defaultValue={initial.note} placeholder="z. B. Bring ein Handtuch mit" className="input-field resize-none" />
      </div>

      <p className="text-[11px] text-neutral-400">
        Zusagen sind unverbindlich und zählen weder als Training noch für Punkte. Alle Zeiten in Berliner Zeit.
      </p>

      <FormMessage error={state?.error} />
      <SubmitButton>{mode === 'create' ? 'Im Team-Chat teilen' : 'Änderungen speichern'}</SubmitButton>
    </form>
  );
}
