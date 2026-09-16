import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAuthUser } from '@/lib/data/profile';
import { getWorkoutDetail, calculateVolumeKg } from '@/lib/data/workouts';
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
      <div className="mt-6 text-5xl">🎉</div>
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

      <Link href="/" className="btn-primary w-full">{t('nav.home')}</Link>
    </div>
  );
}
