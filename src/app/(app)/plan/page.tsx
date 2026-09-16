import Link from 'next/link';
import { requireAuthUser } from '@/lib/data/profile';
import { getOrCreateActivePlan, getPlanDays } from '@/lib/data/plan';
import { t } from '@/lib/i18n';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export default async function PlanPage() {
  const user = await requireAuthUser();
  const plan = await getOrCreateActivePlan(user.id);
  const days = await getPlanDays(plan.id);
  const dayByWeekday = new Map(days.map((d) => [d.weekday, d]));

  return (
    <div className="screen-padding flex flex-col gap-4 pb-4">
      <h1 className="text-2xl font-bold text-neutral-900">{t('plan.title')}</h1>

      <div className="flex flex-col gap-2.5">
        {WEEKDAYS.map((weekday) => {
          const day = dayByWeekday.get(weekday);
          return (
            <Link
              key={weekday}
              href={`/plan/tag/${weekday}`}
              className="card flex items-center justify-between gap-3 py-3.5"
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  {t(`weekday.${weekday}` as const)}
                </p>
                {day?.is_rest_day ? (
                  <p className="mt-0.5 text-base font-semibold text-neutral-500">{t('plan.restDay')} 😌</p>
                ) : day && (day.title || day.exercises.length > 0) ? (
                  <p className="mt-0.5 text-base font-semibold text-neutral-900">
                    {day.title || `${day.exercises.length} Übungen`}
                  </p>
                ) : (
                  <p className="mt-0.5 text-sm text-neutral-400">{t('plan.addExercise')}</p>
                )}
              </div>
              <span className="text-neutral-300">›</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
