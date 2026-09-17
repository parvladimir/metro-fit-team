'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import { createInviteAction } from '@/app/(app)/team/verwalten/einladungen/actions';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { t } from '@/lib/i18n';

export function CreateInviteForm() {
  const [state, formAction] = useFormState(createInviteAction, undefined);
  const [copied, setCopied] = useState(false);

  return (
    <div className="card flex flex-col gap-4">
      {state?.link ? (
        <div className="flex flex-col items-center gap-4">
          <div className="rounded-2xl bg-neutral-100 p-4 shadow-sm">
            <QRCodeSVG value={state.link} size={200} />
          </div>
          <p className="text-center text-xs text-neutral-500">{t('invite.scanHint')}</p>
          <button
            type="button"
            className="btn-secondary w-full"
            onClick={async () => {
              await navigator.clipboard.writeText(state.link!);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? t('common.copied') : t('invite.copyLink')}
          </button>
        </div>
      ) : (
        <form action={formAction} className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-neutral-800">{t('invite.newInvite')}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">Gültig für (Tage)</label>
              <input name="expiresInDays" type="number" defaultValue={7} min={0} className="input-field" />
            </div>
            <div>
              <label className="label text-xs">Max. Nutzungen ({t('common.optional')})</label>
              <input name="maxUses" type="number" min={1} className="input-field" />
            </div>
          </div>
          {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
          <SubmitButton>{t('invite.newInvite')}</SubmitButton>
        </form>
      )}
    </div>
  );
}
