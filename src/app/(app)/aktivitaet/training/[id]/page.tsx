import Link from 'next/link';
import { BackLink } from '@/components/ui/BackLink';
import { notFound, redirect } from 'next/navigation';
import { requireAuthUser, getCurrentProfile, getPrimaryTeamMembership } from '@/lib/data/profile';
import { getWorkoutDetail, calculateVolumeKg } from '@/lib/data/workouts';
import { getExerciseCatalogue } from '@/lib/data/plan';
import { getLastExerciseResults } from '@/lib/data/exercise-history';
import { addWorkoutExerciseAction, deleteSetAction, skipWorkoutAction, startReviewAction } from '../../actions';
import { PlusCircle } from 'lucide-react';
import { SetLogger, type SavedSet } from '@/components/workout/SetLogger';
import { ExerciseActionsProvider, ExerciseMenuButton, type ExerciseRowInfo } from '@/components/workout/ExerciseActions';
import { WorkoutTimerDisplay } from '@/components/workout/WorkoutTimerDisplay';
import { PauseResumeButton } from '@/components/workout/PauseResumeButton';
import { DiscardWorkoutButton } from '@/components/workout/DiscardWorkoutButton';
import { StaleSessionBanner } from '@/components/workout/StaleSessionBanner';
import { ClearDraftsForm } from '@/components/workout/DraftHousekeeping';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { exerciseTypeLabel } from '@/lib/exercise-types';
import { summarizeSet } from '@/lib/workout-metrics';
import { formatTargets, hasTargets } from '@/lib/plan-targets';
import { t } from '@/lib/i18n';
import type { LastResultState } from '@/lib/exercise-history';
import type { WorkoutSet } from '@/types/database';

const slimSet = (s: WorkoutSet): SavedSet => ({
  set_number: s.set_number,
  weight_kg: s.weight_kg,
  reps: s.reps,
  distance_km: s.distance_km,
  duration_seconds: s.duration_seconds,
  metrics: s.metrics ?? {},
});

export default async function TrainingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAuthUser();
  const [workout, profile] = await Promise.all([getWorkoutDetail(id), getCurrentProfile()]);

  if (!workout || workout.user_id !== user.id) notFound();
  if (workout.status === 'abgeschlossen') redirect(`/aktivitaet/training/${id}/zusammenfassung`);

  const membership = profile ? await getPrimaryTeamMembership(profile.id) : null;
  // One batched lookup for the whole screen — the earlier results of every exercise in this workout.
  const [catalogue, lastLoad] = await Promise.all([getExerciseCatalogue(membership?.team_id ?? null), getLastExerciseResults(id)]);
  const volume = calculateVolumeKg(workout.workoutExercises);

  // Until the database has the new functions (they ship with a separate, later step) the controls that
  // depend on them stay hidden instead of failing when tapped.
  const featuresAvailable = lastLoad.status !== 'unavailable';
  const lastResultFor = (exerciseId: string): LastResultState => {
    if (lastLoad.status === 'unavailable') return { status: 'hidden' };
    if (lastLoad.status === 'error') return { status: 'error' };
    const entry = lastLoad.byExercise[exerciseId];
    return entry ? { status: 'ok', entry } : { status: 'none' };
  };
  const rows: ExerciseRowInfo[] = workout.workoutExercises.map((we, i, all) => ({
    id: we.id,
    exerciseId: we.exercise_id,
    name: we.exercise.name,
    type: we.exercise.exercise_type,
    hasSets: we.sets.length > 0,
    isLast: i === all.length - 1,
  }));

  return (
    <div className="screen-padding flex flex-col gap-5 pb-32">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BackLink href="/aktivitaet" />
          <h1 className="text-lg font-bold text-neutral-900">{workout.title || t(`activityType.${workout.activity_type}` as const)}</h1>
        </div>
        <DiscardWorkoutButton workoutId={workout.id} userId={user.id} label={t('workout.cancel')} />
      </div>

      <WorkoutTimerDisplay startedAt={workout.started_at!} pausedSeconds={workout.paused_seconds} pausedAt={workout.paused_at} />

      <StaleSessionBanner
        userId={user.id}
        workoutId={workout.id}
        startedAt={workout.started_at!}
        pausedSeconds={workout.paused_seconds}
        pausedAt={workout.paused_at}
      />

      {volume > 0 && (
        <div className="card flex items-center justify-between">
          <p className="text-xs font-medium text-neutral-500">{t('workout.summary.volume')}</p>
          <p className="text-base font-bold text-neutral-900">{Math.round(volume)} kg</p>
        </div>
      )}

      <ExerciseActionsProvider
        userId={user.id}
        workoutId={workout.id}
        enabled={featuresAvailable}
        rows={rows}
        catalogue={catalogue.map(({ id: exId, name, exercise_type, muscle_group, is_custom }) => ({ id: exId, name, exercise_type, muscle_group, is_custom }))}
      >
      <div className="flex flex-col gap-4">
        {workout.workoutExercises.map((we) => (
          <div key={we.id} id={`we-${we.id}`} tabIndex={-1} className="card flex scroll-mt-4 flex-col gap-3 outline-none">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="break-words text-base font-bold text-neutral-900">{we.exercise.name}</p>
                <p className="text-xs text-neutral-400">{exerciseTypeLabel(we.exercise.exercise_type)}</p>
                {hasTargets(we.planned) && (
                  <p className="mt-1 break-words text-xs text-neutral-400">
                    Geplant: <span className="font-semibold text-neutral-500">{formatTargets(we.exercise.exercise_type, we.planned!)}</span>
                  </p>
                )}
              </div>
              <ExerciseMenuButton workoutExerciseId={we.id} exerciseName={we.exercise.name} />
            </div>

            {we.sets.length > 0 && (
              <div className="flex flex-col gap-2">
                {we.sets.map((s, i) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 rounded-xl bg-neutral-50 px-3 py-2 text-sm">
                    <span className="shrink-0 font-medium text-neutral-500">{i + 1}.</span>
                    <span className="min-w-0 flex-1 break-words font-semibold text-neutral-900">
                      {summarizeSet(we.exercise.exercise_type, s)}
                    </span>
                    <form action={deleteSetAction.bind(null, s.id, workout.id)} className="shrink-0">
                      <button type="submit" className="rounded-lg px-2 py-1 text-xs font-medium text-red-400 transition active:scale-95 active:bg-red-500/10">
                        {t('common.delete')}
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            )}

            <SetLogger
              userId={user.id}
              workoutId={workout.id}
              workoutExerciseId={we.id}
              exerciseId={we.exercise_id}
              exerciseType={we.exercise.exercise_type}
              exerciseName={we.exercise.name}
              savedSets={we.sets.map(slimSet)}
              lastResult={lastResultFor(we.exercise_id)}
              historyEnabled={featuresAvailable}
            />
          </div>
        ))}
      </div>
      </ExerciseActionsProvider>

      <form action={addWorkoutExerciseAction} className="card flex flex-col gap-3">
        <input type="hidden" name="workoutId" value={workout.id} />
        <p className="text-sm font-semibold text-neutral-800">{t('workout.addExercise')}</p>
        <select name="exerciseId" required defaultValue="" className="input-field block w-full min-w-0 truncate">
          <option value="" disabled>{t('exercise.library.title')}</option>
          {catalogue.some((ex) => ex.is_custom) && (
            <optgroup label="Meine Übungen">
              {catalogue.filter((ex) => ex.is_custom).map((ex) => (
                <option key={ex.id} value={ex.id}>{ex.name}</option>
              ))}
            </optgroup>
          )}
          <optgroup label="Katalog">
            {catalogue.filter((ex) => !ex.is_custom).map((ex) => (
              <option key={ex.id} value={ex.id}>{ex.name}</option>
            ))}
          </optgroup>
        </select>
        <button type="submit" className="btn-secondary">{t('workout.addExercise')}</button>
        <Link
          href={`/uebungen/neu?returnTo=${encodeURIComponent(`/aktivitaet/training/${workout.id}`)}`}
          className="btn-ghost self-start px-4 text-sm text-brand"
        >
          <PlusCircle size={16} strokeWidth={2} />
          Eigene Übung erstellen
        </Link>
      </form>

      <div className="fixed left-1/2 z-20 w-full max-w-app -translate-x-1/2 px-4" style={{ bottom: 'calc(5.25rem + env(safe-area-inset-bottom))' }}>
        <div className="flex flex-col gap-2 rounded-2xl border border-white/[0.1] p-2 shadow-lg backdrop-blur-xl" style={{ background: 'linear-gradient(180deg, rgba(31,56,62,0.94), rgba(17,38,43,0.97))' }}>
          <PauseResumeButton workoutId={workout.id} paused={!!workout.paused_at} className="btn-secondary w-full flex items-center justify-center gap-1.5" />
          <div className="flex gap-2">
            <ClearDraftsForm userId={user.id} workoutId={workout.id} action={skipWorkoutAction.bind(null, workout.id)} className="flex-1">
              <button type="submit" className="btn-secondary w-full">{t('workout.skip')}</button>
            </ClearDraftsForm>
            <form action={startReviewAction.bind(null, workout.id)} className="flex-1">
              <SubmitButton>{t('workout.finish')}</SubmitButton>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
