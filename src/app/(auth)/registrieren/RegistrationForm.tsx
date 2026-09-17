'use client';

import { useFormState } from 'react-dom';
import Link from 'next/link';
import { signUpAction } from '../actions';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { FormMessage } from '@/components/ui/FormMessage';
import { t } from '@/lib/i18n';

export function RegistrationForm({ next }: { next: string }) {
  const [state, formAction] = useFormState(signUpAction, undefined);

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-center text-2xl font-bold text-neutral-900">{t('auth.signUp.title')}</h2>

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <div>
          <label className="label" htmlFor="fullName">{t('auth.fullName')}</label>
          <input id="fullName" name="fullName" type="text" autoComplete="name" required className="input-field" />
        </div>
        <div>
          <label className="label" htmlFor="email">{t('auth.email')}</label>
          <input id="email" name="email" type="email" autoComplete="email" required className="input-field" />
        </div>
        <div>
          <label className="label" htmlFor="password">{t('auth.password')}</label>
          <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} className="input-field" />
        </div>
        <div>
          <label className="label" htmlFor="confirmPassword">{t('auth.confirmPassword')}</label>
          <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} className="input-field" />
        </div>

        <FormMessage error={state?.error} success={state?.success} />

        {!state?.success && <SubmitButton>{t('auth.signUp.submit')}</SubmitButton>}
      </form>

      <p className="text-center text-sm text-neutral-500">
        {t('auth.signUp.hasAccount')}{' '}
        <Link href={`/anmelden?next=${encodeURIComponent(next)}`} className="font-semibold text-brand">
          {t('auth.signUp.signIn')}
        </Link>
      </p>
    </div>
  );
}
