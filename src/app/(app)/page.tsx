import Link from 'next/link';
import { Medal, Trophy, Dumbbell, PlusCircle } from 'lucide-react';
import { getAuthUser, getCurrentProfile, getPrimaryTeamMembership } from '@/lib/data/profile';
import { getDashboardData } from '@/lib/data/dashboard';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { WeeklyChart } from '@/components/dashboard/WeeklyChart';
import { t } from '@/lib/i18n';

export default async function DashboardPage() {
  const user = await getAuthUser();
  if (!user) return null;

  // getCurrentProfile and getPrimaryTeamMembership both only need the auth
  // user id, not each other's result — fetch them in parallel rather than
  // one after another (each round trip adds real latency here).
  const [profile, membership] = await Promise.all([getCurrentProfile(), getPrimaryTeamMembership(user.id)]);
  if (!profile) return null;

  const data = await getDashboardData(profile, membership?.team_id ?? null);

  const goalPercent = data.weekly.weeklyGoal > 0 ? (data.weekly.completedWorkouts / data.weekly.weeklyGoal) * 100 : 0;
  const firstName = (profile.full_name || '').split(' ')[0] || 'da';

  return (
    <div className="screen-padding flex flex-col gap-4 pb-4">
      <h1 className="text-page-title text-neutral-900">{t('dashboard.greeting', { name: firstName })}</h1>

      {/* DEINE WOCHE — hero ring, Steps-app style: one big friendly number first */}
      <section className="card flex flex-col items-center pt-6 text-center">
        <p className="section-title mb-4">{t('dashboard.yourWeek')}</p>
        <ProgressRing
          percent={goalPercent}
          size={160}
          strokeWidth={9}
          label={t('dashboard.workoutsOfGoal', { completed: data.weekly.completedWorkouts, goal: data.weekly.weeklyGoal })}
        />

        {data.weekly.pointsDeltaPct !== null && (
          <span
            className={`mt-4 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
              data.weekly.pointsDeltaPct >= 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
            }`}
          >
            {t('dashboard.vsLastWeek', { delta: `${data.weekly.pointsDeltaPct >= 0 ? '+' : ''}${data.weekly.pointsDeltaPct}%` })}
          </span>
        )}

        <div className="mt-5 grid w-full grid-cols-2 gap-3">
          <div className="rounded-2xl bg-neutral-150 px-3 py-3">
            <p className="text-2xl font-bold text-neutral-900">{data.weekly.minutes}</p>
            <p className="text-xs font-medium text-neutral-400">{t('common.minutes')}</p>
          </div>
          <div className="rounded-2xl bg-neutral-150 px-3 py-3">
            <p className="text-2xl font-bold text-neutral-900">{data.weekly.points}</p>
            <p className="text-xs font-medium text-neutral-400">{t('common.points')}</p>
          </div>
        </div>

        <div className="mt-5 w-full border-t border-neutral-100 pt-4 text-left">
          <p className="mb-2 text-xs font-medium text-neutral-400">{t('dashboard.weeklyChart')}</p>
          <WeeklyChart data={data.weeklyChart} />
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        {/* DEIN TEAM */}
        <Link href="/team" className="card flex flex-col justify-between transition active:scale-[0.98]">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-150 text-neutral-500">
              <Medal size={16} strokeWidth={1.9} />
            </span>
            <p className="section-title">{t('dashboard.yourTeam')}</p>
          </div>
          <p className="mt-3 text-3xl font-extrabold tracking-tight text-neutral-900">
            {data.rank ? `#${data.rank}` : '–'}
          </p>
          <p className="text-xs text-neutral-400">{data.rank ? t('dashboard.rank', { rank: data.rank }) : t('dashboard.noRank')}</p>
        </Link>

        {/* HERAUSFORDERUNG */}
        <Link href="/team?tab=herausforderungen" className="card flex flex-col justify-between transition active:scale-[0.98]">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-150 text-neutral-500">
              <Trophy size={16} strokeWidth={1.9} />
            </span>
            <p className="section-title">{t('dashboard.challenge')}</p>
          </div>
          {data.activeChallenge ? (
            <>
              <p className="mt-3 line-clamp-2 text-sm font-semibold text-neutral-900">{data.activeChallenge.title}</p>
              <div className="mt-2">
                <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className="h-full rounded-full bg-brand"
                    style={{ width: `${Math.min(100, (data.activeChallenge.myProgress / data.activeChallenge.target_value) * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-neutral-400">
                  {t('challenge.progress', { current: Math.round(data.activeChallenge.myProgress), target: data.activeChallenge.target_value })}
                </p>
              </div>
            </>
          ) : (
            <p className="mt-3 text-xs text-neutral-400">{t('dashboard.noChallenge')}</p>
          )}
        </Link>
      </div>

      {/* HEUTE */}
      <section className="card">
        <p className="section-title mb-3">{t('dashboard.today')}</p>
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
        <Link href="/aktivitaet/training/neu" className="btn-primary">
          <Dumbbell size={17} strokeWidth={2} />
          {t('nav.startWorkout')}
        </Link>
        <Link href="/aktivitaet/messung/neu" className="btn-secondary">
          <PlusCircle size={17} strokeWidth={2} />
          {t('dashboard.addMeasurement')}
        </Link>
      </section>
    </div>
  );
}
