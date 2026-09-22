import { BackLink } from '@/components/ui/BackLink';
import { notFound } from 'next/navigation';
import { requireAuthUser, getCurrentProfile, getPrimaryTeamMembership } from '@/lib/data/profile';
import { getOrCreateActivePlan, getPlanDay, getExerciseCatalogue } from '@/lib/data/plan';
import { saveDayAction, removeExerciseFromDayAction, deleteDayAction } from '../../actions';
import { AddPlanExerciseForm } from '@/components/plan/AddPlanExerciseForm';
import { SaveAsTemplateButton } from '@/components/plan/SaveAsTemplateButton';
import { ShareToTeamChatButton } from '@/components/sharing/ShareToTeamChatButton';
import type { SharePreviewSource } from '@/components/sharing/SharePreviewSheet';
import { exerciseTypeLabel, muscleGroupLabel } from '@/lib/exercise-types';
import { formatTargets, targetsFromRow } from '@/lib/plan-targets';
import { defaultTemplateName } from '@/lib/plan-templates';
import { t, type TranslationKey } from '@/lib/i18n';

export default async function PlanDayPage({
  params,
  searchParams,
}: {
  params: Promise<{ weekday: string }>;
  searchParams: Promise<{ neu?: string }>;
}) {
  const { weekday: weekdayParam } = await params;
  const { neu } = await searchParams;
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
              day.exercises.map((pe) => {
                const summary = formatTargets(pe.exercise.exercise_type, targetsFromRow(pe.exercise.exercise_type, pe));
                return (
                  <div key={pe.id} className="card flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-semibold text-neutral-900">{pe.exercise.name}</p>
                      <p className="break-words text-xs text-neutral-500">
                        {exerciseTypeLabel(pe.exercise.exercise_type)} · {muscleGroupLabel(pe.exercise.muscle_group)}
                      </p>
                      {summary && <p className="mt-1.5 break-words text-sm font-semibold text-brand">{summary}</p>}
                    </div>
                    <form action={removeExercise.bind(null, pe.id, weekday)} className="shrink-0">
                      <button type="submit" className="btn-destructive px-3 py-2 text-xs">{t('common.delete')}</button>
                    </form>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-neutral-400">{t('plan.noExercises')}</p>
            )}
          </section>

          {day && day.exercises.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <SaveAsTemplateButton
                weekday={weekday}
                suggestedName={day.title || defaultTemplateName(day.exercises.map((pe) => pe.exercise.muscle_group))}
              />
              <ShareToTeamChatButton
                teamId={membership?.team_id ?? null}
                source={{
                  sourceType: 'template',
                  sourcePlanDayId: day.id,
                  defaultTitle: day.title || defaultTemplateName(day.exercises.map((pe) => pe.exercise.muscle_group)),
                  items: day.exercises.map((pe) => ({ name: pe.exercise.name, hasWeight: pe.target_weight_kg != null, hasInstructions: !!pe.exercise.instructions })),
                } satisfies SharePreviewSource}
              />
            </div>
          )}

          <AddPlanExerciseForm
            weekday={weekday}
            dayTitle={day?.title || ''}
            catalogue={catalogue}
            defaultExerciseId={neu}
          />
        </>
      )}
    </div>
  );
}
