'use client';

import { useFormState } from 'react-dom';
import { completeOnboardingAction } from './actions';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { FormMessage } from '@/components/ui/FormMessage';
import { AvatarUploader } from '@/components/onboarding/AvatarUploader';
import { t } from '@/lib/i18n';
import type { FitnessGoal } from '@/types/database';
import { appConfig } from '@/lib/config';

const GOALS: FitnessGoal[] = [
  'general_fitness', 'lose_weight', 'build_muscle', 'improve_strength', 'improve_endurance', 'stay_fit',
];

export function OnboardingForm({ userId, defaultFullName }: { userId: string; defaultFullName: string }) {
  const [state, formAction] = useFormState(completeOnboardingAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-neutral-900">{t('onboarding.welcome.title', { appName: appConfig.name })}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t('onboarding.welcome.description')}</p>
      </div>

      <AvatarUploader userId={userId} />

      <div>
        <label className="label" htmlFor="fullName">{t('onboarding.name.label')}</label>
        <input id="fullName" name="fullName" defaultValue={defaultFullName} required className="input-field" />
      </div>

      <div>
        <span className="label">{t('onboarding.goal.label')}</span>
        <div className="grid grid-cols-2 gap-2">
          {GOALS.map((goal, i) => (
            <label
              key={goal}
              className="flex cursor-pointer items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm font-medium has-[:checked]:border-brand has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700"
            >
              <input type="radio" name="fitnessGoal" value={goal} defaultChecked={i === 0} className="accent-brand" required />
              {t(`onboarding.goal.${goal}` as const)}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="label" htmlFor="weeklyGoal">{t('onboarding.weeklyGoal.label')}</label>
        <select id="weeklyGoal" name="weeklyGoal" defaultValue={3} className="input-field">
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <option key={n} value={n}>
              {n} {t('onboarding.weeklyGoal.unit')}
            </option>
          ))}
        </select>
      </div>

      <div className="card">
        <p className="mb-3 text-sm font-semibold text-neutral-800">{t('onboarding.bodyData.label')}</p>
        <p className="mb-4 text-xs text-neutral-500">{t('onboarding.bodyData.description')}</p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label" htmlFor="height">{t('onboarding.height')}</label>
            <input id="height" name="height" type="number" inputMode="decimal" className="input-field" />
          </div>
          <div>
            <label className="label" htmlFor="weight">{t('onboarding.weight')}</label>
            <input id="weight" name="weight" type="number" inputMode="decimal" className="input-field" />
          </div>
          <div>
            <label className="label" htmlFor="age">{t('onboarding.age')}</label>
            <input id="age" name="age" type="number" inputMode="numeric" className="input-field" />
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-neutral-100 p-4">
        <p className="text-sm font-semibold text-neutral-800">{t('onboarding.privacy.title')}</p>
        <p className="mt-1 text-xs leading-relaxed text-neutral-500">{t('onboarding.privacy.description')}</p>
      </div>

      <FormMessage error={state?.error} />

      <SubmitButton>{t('onboarding.finish')}</SubmitButton>
    </form>
  );
}
