'use client';

import { useEffect, useRef } from 'react';
import { useFormState } from 'react-dom';
import { Mail } from 'lucide-react';
import { sendInviteEmailAction } from '@/app/(app)/team/verwalten/einladungen/actions';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { FormMessage } from '@/components/ui/FormMessage';

export function EmailInviteForm() {
  const [state, formAction] = useFormState(sendInviteEmailAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="card flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand">
          <Mail size={17} strokeWidth={2} />
        </span>
        <p className="text-sm font-semibold text-neutral-800">Per E-Mail einladen</p>
      </div>
      <div className="min-w-0">
        <label className="label text-xs" htmlFor="invite-email">E-Mail-Adresse</label>
        <input
          id="invite-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="off"
          required
          maxLength={254}
          placeholder="name@beispiel.de"
          className="input-field"
        />
      </div>
      <FormMessage error={state?.error} success={state?.success} />
      <SubmitButton>Einladung senden</SubmitButton>
    </form>
  );
}
