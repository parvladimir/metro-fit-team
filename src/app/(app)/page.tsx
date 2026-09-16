import Link from 'next/link';
import { getCurrentProfile, getPrimaryTeamMembership } from '@/lib/data/profile';
import { getDashboardData } from '@/lib/data/dashboard';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { WeeklyChart } from '@/components/dashboard/WeeklyChart';
import { t } from '@/lib/i18n';

export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const membership = await getPrimaryTeamMembership(profile.id);
  const data = await getDashboardData(profile, membership?.team_id ?? null);

  const goalPercent = data.weekly.weeklyGoal > 0 ? (data.weekly.completedWorkouts / data.weekly.weeklyGoal) * 100 : 0;
  const firstName = (profile.full_name || '').split(' ')[0] || 'da';

  return (
    <div className="screen-padding flex flex-col gap-5 pb-4">
      <h1 className="text-2xl font-bold text-neutral-900">{t('dashboard.greeting', { name: firstName })}</h1>

      {/* DEINE WOCHE */}
      <section className="card">
        <p className="section-title mb-3">{t('dashboard.yourWeek')}</p>
        <div className="flex items-center gap-5">
          <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
            <ProgressRing percent={goalPercent} />
            <span className="absolute text-xl font-extrabold text-neutral-900">{Math.round(goalPercent)}%</span>
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <p className="text-base font-semibold text-neutral-900">
              {t('dashboard.workoutsOfGoal', { completed: data.weekly.completedWorkouts, goal: data.weekly.weeklyGoal })}
            </p>
            <div className="flex gap-4 text-sm text-neutral-500">
              <span>{data.weekly.minutes} {t('common.minutes')}</span>
              <span>{data.weekly.points} {t('common.points')}</span>
            </div>
            {data.weekly.pointsDeltaPct !== null && (
              <span className={`text-xs font-semibold ${data.weekly.pointsDeltaPct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {t('dashboard.vsLastWeek', { delta: `${data.weekly.pointsDeltaPct >= 0 ? '+' : ''}${data.weekly.pointsDeltaPct}%` })}
              </span>
            )}
          </div>
        </div>
        <div className="mt-4 border-t border-neutral-100 pt-4">
          <p className="mb-2 text-xs font-medium text-neutral-500">{t('dashboard.weeklyChart')}</p>
          <WeeklyChart data={data.weeklyChart} />
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        {/* DEIN TEAM */}
        <Link href="/team" className="card flex flex-col justify-between">
          <p className="section-title">{t('dashboard.yourTeam')}</p>
          <p className="mt-2 metric-number text-3xl">
            {data.rank ? `#${data.rank}` : '–'}
          </p>
          <p className="text-xs text-neutral-500">{data.rank ? t('dashboard.rank', { rank: data.rank }) : t('dashboard.noRank')}</p>
        </Link>

        {/* HERAUSFORDERUNG */}
        <Link href="/team?tab=herausforderungen" className="card flex flex-col justify-between">
          <p className="section-title">{t('dashboard.challenge')}</p>
          {data.activeChallenge ? (
            <>
              <p className="mt-2 line-clamp-2 text-sm font-semibold text-neutral-900">{data.activeChallenge.title}</p>
              <div className="mt-2">
                <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className="h-full rounded-full bg-brand"
                    style={{ width: `${Math.min(100, (data.activeChallenge.myProgress / data.activeChallenge.target_value) * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  {t('challenge.progress', { current: Math.round(data.activeChallenge.myProgress), target: data.activeChallenge.target_value })}
                </p>
              </div>
            </>
          ) : (
            <p className="mt-2 text-xs text-neutral-400">{t('dashboard.noChallenge')}</p>
          )}
        </Link>
      </div>

      {/* HEUTE */}
      <section className="card">
        <p className="section-title mb-2">{t('dashboard.today')}</p>
        {data.todayPlanDay?.is_rest_day ? (
          <p className="text-base font-semibold text-neutral-900">{t('dashboard.restDay')} 😌</p>
        ) : data.todayPlanDay ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-lg font-bold text-neutral-900">{data.todayPlanDay.title || t('workout.selectType')}</p>
              <p className="text-xs text-neutral-500">{data.todayPlanDay.exerciseCount} Übungen</p>
            </div>
            <Link
              href={data.todayWorkout ? `/aktivitaet/training/${data.todayWorkout.id}` : `/aktivitaet/training/neu?planDayId=${data.todayPlanDay.id}`}
              className="btn-primary px-5 py-3"
            >
              {t('workout.start')}
            </Link>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-neutral-500">{t('dashboard.noWorkoutToday')}</p>
            <Link href="/aktivitaet/training/neu" className="btn-secondary px-4 py-2.5 text-sm">
              {t('dashboard.addWorkout')}
            </Link>
          </div>
        )}
      </section>

      {/* Quick actions */}
      <section className="grid grid-cols-2 gap-3">
        <Link href="/aktivitaet/training/neu" className="btn-primary">{t('nav.startWorkout')}</Link>
        <Link href="/aktivitaet/messung/neu" className="btn-secondary">{t('dashboard.addMeasurement')}</Link>
      </section>
    </div>
  );
}
