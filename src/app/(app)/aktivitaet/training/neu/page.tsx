import Link from 'next/link';
import { BackLink } from '@/components/ui/BackLink';
import { createWorkoutAction } from '../../actions';
import { t } from '@/lib/i18n';
import type { ActivityType } from '@/types/database';

const ACTIVITY_TYPES: ActivityType[] = [
  'krafttraining', 'laufen', 'gehen', 'radfahren', 'schwimmen', 'cardio', 'fussball', 'fitnesskurs', 'sonstiges',
];

export default async function NeuesTrainingPage({ searchParams }: { searchParams: Promise<{ planDayId?: string }> }) {
  const { planDayId } = await searchParams;

  return (
    <div className="screen-padding flex flex-col gap-5 pb-8">
      <div className="flex items-center gap-3">
        <BackLink href="/aktivitaet" />
        <h1 className="text-xl font-bold text-neutral-900">{t('workout.new')}</h1>
      </div>

      <form action={createWorkoutAction} className="flex flex-col gap-4">
        {planDayId && <input type="hidden" name="planDayId" value={planDayId} />}
        <div>
          <label className="label" htmlFor="title">{t('plan.dayTitle')} ({t('common.optional')})</label>
          <input id="title" name="title" className="input-field" placeholder={t('plan.dayTitlePlaceholder')} />
        </div>

        <div>
          <span className="label">{t('workout.selectType')}</span>
          <div className="grid grid-cols-3 gap-2">
            {ACTIVITY_TYPES.map((type, i) => (
              <label
                key={type}
                className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-neutral-200 bg-neutral-100 px-2 py-3 text-center text-xs font-medium has-[:checked]:border-brand has-[:checked]:bg-brand-50 has-[:checked]:text-brand"
              >
                <input type="radio" name="activityType" value={type} defaultChecked={i === 0} className="sr-only" required />
                {t(`activityType.${type}` as const)}
              </label>
            ))}
          </div>
        </div>

        <button type="submit" className="btn-primary mt-2">{t('workout.start')}</button>
      </form>
    </div>
  );
}
