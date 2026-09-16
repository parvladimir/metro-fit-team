'use client';

import { useFormState } from 'react-dom';
import Link from 'next/link';
import { forgotPasswordAction } from '../actions';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { FormMessage } from '@/components/ui/FormMessage';
import { t } from '@/lib/i18n';

export default function PasswortVergessenPage() {
  const [state, formAction] = useFormState(forgotPasswordAction, undefined);

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-center text-2xl font-bold text-neutral-900">{t('auth.forgotPassword.title')}</h2>
      <p className="text-center text-sm text-neutral-500">{t('auth.forgotPassword.description')}</p>

      <form action={formAction} className="flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="email">{t('auth.email')}</label>
          <input id="email" name="email" type="email" autoComplete="email" required className="input-field" />
        </div>

        <FormMessage error={state?.error} success={state?.success} />

        {!state?.success && <SubmitButton>{t('auth.forgotPassword.submit')}</SubmitButton>}
      </form>

      <p className="text-center text-sm text-neutral-500">
        <Link href="/anmelden" className="font-semibold text-brand">
          {t('common.back')}
        </Link>
      </p>
    </div>
  );
}
