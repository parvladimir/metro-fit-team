import Link from 'next/link';
import { BackLink } from '@/components/ui/BackLink';
import { notFound } from 'next/navigation';
import { requireAuthUser, getCurrentProfile, getPrimaryTeamMembership } from '@/lib/data/profile';
import { getOrCreateActivePlan, getPlanDay, getExerciseCatalogue } from '@/lib/data/plan';
import { saveDayAction, addExerciseToDayAction, removeExerciseFromDayAction, deleteDayAction } from '../../actions';
import { t, type TranslationKey } from '@/lib/i18n';

export default async function PlanDayPage({ params }: { params: Promise<{ weekday: string }> }) {
  const { weekday: weekdayParam } = await params;
  const weekday = Number(weekdayParam);
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) notFound();

  const user = await requireAuthUser();
  const profile = await getCurrentProfile();
  const membership = profile ? await getPrimaryTeamMembership(profile.id) : null;
  const plan = await getOrCreateActivePlan(user.id);
  const day = await getPlanDay(plan.id, weekday);
  const catalogue = await getExerciseCatalogue(membership?.team_id ?? null);

  const removeExercise = removeExerciseFromDayAction.bind(null);
  const deleteDay = deleteDayAction.bind(null);

  return (
    <div className="screen-padding flex flex-col gap-5 pb-8">
      <div className="flex items-center gap-3">
        <BackLink href="/plan" />
        <h1 className="text-xl font-bold text-neutral-900">{t(`weekday.${weekday}` as TranslationKey)}</h1>
      </div>

      <form action={saveDayAction} className="card flex flex-col gap-3">
        <input type="hidden" name="weekday" value={weekday} />
        <div>
          <label className="label" htmlFor="title">{t('plan.dayTitle')}</label>
          <input
            id="title"
            name="title"
            defaultValue={day?.title || ''}
            placeholder={t('plan.dayTitlePlaceholder')}
            className="input-field"
            disabled={day?.is_rest_day}
          />
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
          <input type="checkbox" name="isRestDay" defaultChecked={day?.is_rest_day} className="h-5 w-5 accent-brand" />
          {t('plan.markRestDay')}
        </label>
        <button type="submit" className="btn-secondary self-start px-5 py-2.5 text-sm">{t('common.save')}</button>
      </form>

      {day && (
        <form action={deleteDay.bind(null, day.id, weekday)}>
          <button type="submit" className="btn-destructive">{t('plan.removeDay')}</button>
        </form>
      )}

      {!day?.is_rest_day && (
        <>
          <section className="flex flex-col gap-2">
            <p className="section-title">{t('plan.selectExercises')}</p>
            {day && day.exercises.length > 0 ? (
              day.exercises.map((pe) => (
                <div key={pe.id} className="card flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-semibold text-neutral-900">{pe.exercise.name}</p>
                    <p className="text-xs text-neutral-500">
                      {t(`exercise.muscleGroup.${pe.exercise.muscle_group}` as const)} · {pe.target_sets}×{pe.target_reps}
                    </p>
                  </div>
                  <form action={removeExercise.bind(null, pe.id, weekday)}>
                    <button type="submit" className="btn-destructive px-3 py-2 text-xs">{t('common.delete')}</button>
                  </form>
                </div>
              ))
            ) : (
              <p className="text-sm text-neutral-400">{t('plan.noExercises')}</p>
            )}
          </section>

          <form action={addExerciseToDayAction} className="card flex flex-col gap-3">
            <input type="hidden" name="weekday" value={weekday} />
            <input type="hidden" name="title" value={day?.title || ''} />
            <p className="text-sm font-semibold text-neutral-800">{t('plan.addExercise')}</p>
            <select name="exerciseId" required className="input-field" defaultValue="">
              <option value="" disabled>
                {t('exercise.library.title')}
              </option>
              {catalogue.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name} ({t(`exercise.muscleGroup.${ex.muscle_group}` as const)})
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="targetSets">{t('exercise.defaultSets')}</label>
                <input id="targetSets" name="targetSets" type="number" defaultValue={3} min={1} className="input-field" />
              </div>
              <div>
                <label className="label" htmlFor="targetReps">{t('exercise.defaultReps')}</label>
                <input id="targetReps" name="targetReps" type="number" defaultValue={10} min={1} className="input-field" />
              </div>
            </div>
            <button type="submit" className="btn-primary">{t('plan.addExercise')}</button>
          </form>
        </>
      )}
    </div>
  );
}
