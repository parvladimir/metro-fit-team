'use client';

import { useFormState } from 'react-dom';
import { resetPasswordAction } from '../actions';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { FormMessage } from '@/components/ui/FormMessage';
import { t } from '@/lib/i18n';

export function ResetPasswordForm() {
  const [state, formAction] = useFormState(resetPasswordAction, undefined);

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-center text-2xl font-bold text-neutral-900">{t('auth.resetPassword.title')}</h2>

      <form action={formAction} className="flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="password">{t('auth.resetPassword.newPassword')}</label>
          <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} className="input-field" />
        </div>
        <div>
          <label className="label" htmlFor="confirmPassword">{t('auth.confirmPassword')}</label>
          <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} className="input-field" />
        </div>
        <p className="text-xs text-neutral-400">Mindestens 8 Zeichen.</p>

        <FormMessage error={state?.error} success={state?.success} />

        <SubmitButton>{t('auth.resetPassword.submit')}</SubmitButton>
      </form>
    </div>
  );
}
