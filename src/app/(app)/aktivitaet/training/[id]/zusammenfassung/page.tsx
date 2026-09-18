import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PartyPopper } from 'lucide-react';
import { requireAuthUser } from '@/lib/data/profile';
import { getWorkoutDetail, calculateVolumeKg } from '@/lib/data/workouts';
import { formatAchieved, formatTargets, hasTargets } from '@/lib/plan-targets';
import { t } from '@/lib/i18n';

export default async function ZusammenfassungPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAuthUser();
  const workout = await getWorkoutDetail(id);
  if (!workout || workout.user_id !== user.id) notFound();

  const volume = calculateVolumeKg(workout.workoutExercises);
  const minutes = workout.duration_seconds ? Math.round(workout.duration_seconds / 60) : 0;

  return (
    <div className="screen-padding flex flex-col items-center gap-6 pb-8 text-center">
      <div className="mt-6 flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand">
        <PartyPopper size={30} strokeWidth={1.75} />
      </div>
      <div>
        <h1 className="text-xl font-bold text-neutral-900">{workout.title || t(`activityType.${workout.activity_type}` as const)}</h1>
        <p className="text-sm text-neutral-500">{t('workout.status.abgeschlossen')}</p>
      </div>

      <div className="grid w-full grid-cols-3 gap-3">
        <div className="card items-center">
          <p className="section-title">{t('workout.summary.duration')}</p>
          <p className="mt-1 metric-number text-2xl">{minutes}</p>
          <p className="text-xs text-neutral-400">{t('common.minutes')}</p>
        </div>
        {volume > 0 && (
          <div className="card items-center">
            <p className="section-title">{t('workout.summary.volume')}</p>
            <p className="mt-1 metric-number text-2xl">{Math.round(volume)}</p>
            <p className="text-xs text-neutral-400">kg</p>
          </div>
        )}
        {workout.distance_km && (
          <div className="card items-center">
            <p className="section-title">{t('workout.distance')}</p>
            <p className="mt-1 metric-number text-2xl">{workout.distance_km}</p>
            <p className="text-xs text-neutral-400">km</p>
          </div>
        )}
      </div>

      {workout.workoutExercises.some((we) => hasTargets(we.planned) && we.sets.length > 0) && (
        <section className="flex w-full flex-col gap-2 text-left">
          <p className="section-title">Geplant vs. erreicht</p>
          {workout.workoutExercises
            .filter((we) => hasTargets(we.planned) && we.sets.length > 0)
            .map((we) => (
              <div key={we.id} className="card flex flex-col gap-1.5 py-3">
                <p className="break-words text-sm font-semibold text-neutral-900">{we.exercise.name}</p>
                <p className="break-words text-xs text-neutral-400">
                  Geplant: <span className="font-semibold text-neutral-500">{formatTargets(we.exercise.exercise_type, we.planned!)}</span>
                </p>
                <p className="break-words text-xs text-neutral-400">
                  Erreicht: <span className="font-semibold text-brand">{formatAchieved(we.exercise.exercise_type, we.sets) || '—'}</span>
                </p>
              </div>
            ))}
        </section>
      )}

      <Link href="/" className="btn-primary w-full">{t('nav.home')}</Link>
    </div>
  );
}
