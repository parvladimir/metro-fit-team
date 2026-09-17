'use client';

import { useFormState } from 'react-dom';
import Link from 'next/link';
import { signInAction } from '../actions';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { FormMessage } from '@/components/ui/FormMessage';
import { t } from '@/lib/i18n';

export function SignInForm({ next }: { next: string }) {
  const [state, formAction] = useFormState(signInAction, undefined);

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-center text-2xl font-bold text-neutral-900">{t('auth.signIn.title')}</h2>

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <div>
          <label className="label" htmlFor="email">{t('auth.email')}</label>
          <input id="email" name="email" type="email" autoComplete="email" required className="input-field" />
        </div>
        <div>
          <label className="label" htmlFor="password">{t('auth.password')}</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className="input-field" />
        </div>

        <FormMessage error={state?.error} success={state?.success} />

        <SubmitButton>{t('auth.signIn.submit')}</SubmitButton>
      </form>

      <div className="flex flex-col items-center gap-3 text-sm">
        <Link href="/passwort-vergessen" className="font-medium text-brand">
          {t('auth.signIn.forgotPassword')}
        </Link>
        <p className="text-neutral-500">
          {t('auth.signIn.noAccount')}{' '}
          <Link href="/registrieren" className="font-semibold text-brand">
            {t('auth.signIn.createAccount')}
          </Link>
        </p>
      </div>
    </div>
  );
}
