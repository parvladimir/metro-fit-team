import { notFound } from 'next/navigation';
import { requireAuthUser } from '@/lib/data/profile';
import { getWorkoutDetail } from '@/lib/data/workouts';
import { finishWorkoutAction } from '../../../actions';
import { t } from '@/lib/i18n';

export default async function BeendenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAuthUser();
  const workout = await getWorkoutDetail(id);
  if (!workout || workout.user_id !== user.id) notFound();

  const showDistance = ['laufen', 'gehen', 'radfahren', 'schwimmen'].includes(workout.activity_type);

  return (
    <div className="screen-padding flex flex-col gap-5 pb-8">
      <h1 className="text-xl font-bold text-neutral-900">{t('workout.finish')}</h1>

      <form action={finishWorkoutAction} className="flex flex-col gap-4">
        <input type="hidden" name="workoutId" value={workout.id} />

        {showDistance && (
          <div>
            <label className="label" htmlFor="distanceKm">{t('workout.distance')} (km)</label>
            <input id="distanceKm" name="distanceKm" type="number" step="0.1" inputMode="decimal" className="input-field" />
          </div>
        )}

        <div>
          <label className="label" htmlFor="notes">{t('workout.notes')}</label>
          <textarea id="notes" name="notes" rows={3} placeholder={t('workout.notesPlaceholder')} className="input-field" />
        </div>

        <button type="submit" className="btn-primary">{t('workout.finish')}</button>
      </form>
    </div>
  );
}
