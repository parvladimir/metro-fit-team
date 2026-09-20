import { BackLink } from '@/components/ui/BackLink';
import { requireAuthUser, getCurrentProfile } from '@/lib/data/profile';
import { AvatarEditor } from '@/components/profile/AvatarEditor';
import { updateProfileAction } from '../actions';
import { t } from '@/lib/i18n';
import type { FitnessGoal } from '@/types/database';

const GOALS: FitnessGoal[] = [
  'general_fitness', 'lose_weight', 'build_muscle', 'improve_strength', 'improve_endurance', 'stay_fit',
];

export default async function ProfilBearbeitenPage() {
  const user = await requireAuthUser();
  const profile = await getCurrentProfile();
  if (!profile) return null;

  return (
    <div className="screen-padding flex flex-col gap-6 pb-8">
      <div className="flex items-center gap-3">
        <BackLink href="/profil" />
        <h1 className="text-xl font-bold text-neutral-900">{t('profile.editProfile.title')}</h1>
      </div>

      <AvatarEditor userId={user.id} name={profile.full_name || ''} initialUrl={profile.avatar_url} />

      <form action={updateProfileAction} className="flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="fullName">{t('profile.editProfile.name')}</label>
          <input id="fullName" name="fullName" defaultValue={profile.full_name || ''} required className="input-field" />
        </div>

        <div>
          <span className="label">{t('onboarding.goal.label')}</span>
          <div className="grid grid-cols-2 gap-2">
            {GOALS.map((goal) => (
              <label
                key={goal}
                className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/[0.1] bg-surface-3 px-3 py-3 text-neutral-700 text-sm font-medium transition-all duration-200 has-[:checked]:border-brand/60 has-[:checked]:bg-brand/[0.14] has-[:checked]:text-brand has-[:checked]:shadow-[0_0_0_1px_rgba(0,215,245,0.25)]"
              >
                <input
                  type="radio"
                  name="fitnessGoal"
                  value={goal}
                  defaultChecked={profile.fitness_goal === goal}
                  className="accent-brand"
                />
                {t(`onboarding.goal.${goal}` as const)}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="weeklyGoal">{t('onboarding.weeklyGoal.label')}</label>
          <select id="weeklyGoal" name="weeklyGoal" defaultValue={profile.weekly_goal} className="input-field">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                {n} {t('onboarding.weeklyGoal.unit')}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="btn-primary">{t('common.saveChanges')}</button>
      </form>
    </div>
  );
}
