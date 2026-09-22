import Link from 'next/link';
import { ChevronRight, Moon, Plus, Dumbbell } from 'lucide-react';
import { requireAuthUser } from '@/lib/data/profile';
import { getOrCreateActivePlan, getPlanDays } from '@/lib/data/plan';
import { getTemplates } from '@/lib/data/plan-templates';
import { TemplatesSection, type DayStatus } from '@/components/plan/TemplatesSection';
import { t, type TranslationKey } from '@/lib/i18n';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const todayWeekday = ((new Date().getDay() + 6) % 7) + 1;

export default async function PlanPage() {
  const user = await requireAuthUser();
  const plan = await getOrCreateActivePlan(user.id);
  const [days, templates] = await Promise.all([getPlanDays(plan.id), getTemplates(user.id)]);
  const dayByWeekday = new Map(days.map((d) => [d.weekday, d]));

  const dayStatuses: DayStatus[] = WEEKDAYS.map((weekday) => {
    const day = dayByWeekday.get(weekday);
    return {
      weekday,
      label: t(`weekday.${weekday}` as TranslationKey),
      isRestDay: day?.is_rest_day ?? false,
      exerciseCount: day?.exercises.length ?? 0,
    };
  });

  return (
    <div className="screen-padding flex flex-col gap-4 pb-4">
      <h1 className="text-page-title text-neutral-900">{t('plan.title')}</h1>

      <div className="flex flex-col gap-2.5">
        {WEEKDAYS.map((weekday) => {
          const day = dayByWeekday.get(weekday);
          return (
            <Link
              key={weekday}
              href={`/plan/tag/${weekday}`}
              className={`list-row justify-between ${weekday === todayWeekday ? 'accent-primary card-accent' : ''}`}
            >
              <span className={`icon-chip h-10 w-10 ${day?.is_rest_day ? 'accent-info' : !day || (!day.title && day.exercises.length === 0) ? '!border-white/10 !bg-neutral-150/60 !text-neutral-500' : ''}`}>
                {day?.is_rest_day ? (
                  <Moon size={18} strokeWidth={2} />
                ) : day && (day.title || day.exercises.length > 0) ? (
                  <Dumbbell size={18} strokeWidth={2} />
                ) : (
                  <Plus size={18} strokeWidth={2} />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-xs font-semibold uppercase tracking-wide ${weekday === todayWeekday ? 'text-brand' : 'text-neutral-500'}`}>
                  {t(`weekday.${weekday}` as const)}
                  {weekday === todayWeekday && ' · Heute'}
                </p>
                {day?.is_rest_day ? (
                  <p className="mt-0.5 text-base font-semibold text-neutral-600">{t('plan.restDay')}</p>
                ) : day && (day.title || day.exercises.length > 0) ? (
                  <p className="mt-0.5 truncate text-base font-semibold text-neutral-900">
                    {day.title || `${day.exercises.length} Übungen`}
                  </p>
                ) : (
                  <p className="mt-0.5 text-sm text-neutral-500">{t('plan.addExercise')}</p>
                )}
              </div>
              <ChevronRight size={18} className="shrink-0 text-neutral-400" />
            </Link>
          );
        })}
      </div>

      <TemplatesSection templates={templates} dayStatuses={dayStatuses} />
    </div>
  );
}
