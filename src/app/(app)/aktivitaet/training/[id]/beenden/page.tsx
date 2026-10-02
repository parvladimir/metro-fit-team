import { notFound, redirect } from 'next/navigation';
import { requireAuthUser } from '@/lib/data/profile';
import { getWorkoutDetail } from '@/lib/data/workouts';
import { ReviewWorkoutForm } from '@/components/workout/ReviewWorkoutForm';
import { computeElapsedSeconds } from '@/lib/workout-timer';
import { localTimeString } from '@/lib/date';
import { t } from '@/lib/i18n';

export default async function BeendenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAuthUser();
  const workout = await getWorkoutDetail(id);
  if (!workout || workout.user_id !== user.id) notFound();
  if (workout.status === 'abgeschlossen') redirect(`/aktivitaet/training/${id}/zusammenfassung`);
  // Reached without going through "Beenden" first (stale bookmark/back
  // button) — never pause as a side effect of loading this page; send the
  // user back to the screen with the real controls instead.
  if (workout.status !== 'laeuft' || !workout.paused_at) redirect(`/aktivitaet/training/${id}`);

  const pausedMoment = new Date(workout.paused_at);
  const defaultDurationSeconds = computeElapsedSeconds({
    startedAt: workout.started_at!,
    pausedSeconds: workout.paused_seconds,
    pausedAt: null,
    now: pausedMoment,
  });
  const showDistance = ['laufen', 'gehen', 'radfahren', 'schwimmen'].includes(workout.activity_type);

  return (
    <div className="screen-padding flex flex-col gap-5 pb-8">
      <h1 className="text-xl font-bold text-neutral-900">{t('workout.finish')}</h1>
      <ReviewWorkoutForm
        userId={user.id}
        workoutId={workout.id}
        defaultDurationSeconds={defaultDurationSeconds}
        defaultTime={localTimeString(pausedMoment)}
        pausedSeconds={workout.paused_seconds}
        showDistance={showDistance}
      />
    </div>
  );
}
