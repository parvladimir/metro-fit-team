import Link from 'next/link';
import { BackLink } from '@/components/ui/BackLink';
import { notFound, redirect } from 'next/navigation';
import { requireAuthUser, getCurrentProfile, getPrimaryTeamMembership } from '@/lib/data/profile';
import { getWorkoutDetail, calculateVolumeKg } from '@/lib/data/workouts';
import { getExerciseCatalogue } from '@/lib/data/plan';
import { addWorkoutExerciseAction, addSetAction, deleteSetAction, skipWorkoutAction, discardWorkoutAction } from '../../actions';
import { t } from '@/lib/i18n';

export default async function TrainingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAuthUser();
  const [workout, profile] = await Promise.all([getWorkoutDetail(id), getCurrentProfile()]);

  if (!workout || workout.user_id !== user.id) notFound();
  if (workout.status === 'abgeschlossen') redirect(`/aktivitaet/training/${id}/zusammenfassung`);

  const membership = profile ? await getPrimaryTeamMembership(profile.id) : null;
  const catalogue = await getExerciseCatalogue(membership?.team_id ?? null);
  const volume = calculateVolumeKg(workout.workoutExercises);

  return (
    <div className="screen-padding flex flex-col gap-5 pb-32">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BackLink href="/aktivitaet" />
          <div>
            <h1 className="text-lg font-bold text-neutral-900">{workout.title || t(`activityType.${workout.activity_type}` as const)}</h1>
            <p className="text-xs font-semibold text-brand">{t('workout.status.laeuft')}</p>
          </div>
        </div>
        <form action={discardWorkoutAction.bind(null, workout.id)}>
          <button type="submit" className="btn-destructive px-3.5 py-2 text-xs">{t('workout.cancel')}</button>
        </form>
      </div>

      {volume > 0 && (
        <div className="card flex items-center justify-between">
          <p className="text-xs font-medium text-neutral-500">{t('workout.summary.volume')}</p>
          <p className="text-base font-bold text-neutral-900">{Math.round(volume)} kg</p>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {workout.workoutExercises.map((we) => (
          <div key={we.id} className="card flex flex-col gap-3">
            <p className="text-base font-bold text-neutral-900">{we.exercise.name}</p>

            {we.sets.length > 0 && (
              <div className="flex flex-col gap-2">
                {we.sets.map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded-xl bg-neutral-50 px-3 py-2 text-sm">
                    <span className="font-medium text-neutral-500">{t('workout.set', { number: s.set_number })}</span>
                    <span className="font-semibold text-neutral-900">
                      {s.weight_kg ? `${s.weight_kg} kg` : ''} {s.reps ? `× ${s.reps} ${t('workout.reps')}` : ''}
                    </span>
                    <form action={deleteSetAction.bind(null, s.id, workout.id)}>
                      <button type="submit" className="rounded-lg px-2 py-1 text-xs font-medium text-red-400 transition active:scale-95 active:bg-red-500/10">
                        {t('common.delete')}
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            )}

            <form action={addSetAction} className="flex items-end gap-2">
              <input type="hidden" name="workoutId" value={workout.id} />
              <input type="hidden" name="workoutExerciseId" value={we.id} />
              <div className="flex-1">
                <label className="label text-xs">{t('workout.weight')}</label>
                <input name="weight" type="number" step="0.5" inputMode="decimal" className="input-field py-2.5 text-sm" />
              </div>
              <div className="flex-1">
                <label className="label text-xs">{t('workout.reps')}</label>
                <input name="reps" type="number" inputMode="numeric" className="input-field py-2.5 text-sm" />
              </div>
              <button type="submit" className="btn-primary shrink-0 px-4 py-2.5 text-sm">{t('workout.addSet')}</button>
            </form>
          </div>
        ))}
      </div>

      <form action={addWorkoutExerciseAction} className="card flex flex-col gap-3">
        <input type="hidden" name="workoutId" value={workout.id} />
        <p className="text-sm font-semibold text-neutral-800">{t('workout.addExercise')}</p>
        <select name="exerciseId" required defaultValue="" className="input-field">
          <option value="" disabled>{t('exercise.library.title')}</option>
          {catalogue.map((ex) => (
            <option key={ex.id} value={ex.id}>{ex.name}</option>
          ))}
        </select>
        <button type="submit" className="btn-secondary">{t('workout.addExercise')}</button>
      </form>

      <div className="fixed bottom-16 left-1/2 z-20 w-full max-w-app -translate-x-1/2 px-4">
        <div className="flex gap-2 rounded-2xl bg-neutral-100 p-2 shadow-lg ring-1 ring-neutral-100">
          <form action={skipWorkoutAction.bind(null, workout.id)} className="flex-1">
            <button type="submit" className="btn-secondary w-full">{t('workout.skip')}</button>
          </form>
          <Link href={`/aktivitaet/training/${workout.id}/beenden`} className="btn-primary flex-1">
            {t('workout.finish')}
          </Link>
        </div>
      </div>
    </div>
  );
}
