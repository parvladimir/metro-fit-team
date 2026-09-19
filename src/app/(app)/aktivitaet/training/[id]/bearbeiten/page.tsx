import { notFound, redirect } from 'next/navigation';
import { BackLink } from '@/components/ui/BackLink';
import { requireAuthUser } from '@/lib/data/profile';
import { getWorkoutDetail } from '@/lib/data/workouts';
import { WorkoutEditForm, type EditExercise } from '@/components/workout/WorkoutEditForm';
import { localDateString } from '@/lib/set-input';
import { formatDuration } from '@/lib/workout-metrics';

export default async function WorkoutBearbeitenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAuthUser();
  const workout = await getWorkoutDetail(id);
  // Only the owner can ever open the editor (RLS also hides other people's workouts).
  if (!workout || workout.user_id !== user.id) notFound();
  if (workout.status !== 'abgeschlossen' || !workout.finished_at) redirect(`/aktivitaet/training/${id}`);

  const exercises: EditExercise[] = workout.workoutExercises.map((we) => ({
    id: we.id,
    name: we.exercise.name,
    type: we.exercise.exercise_type,
    sets: we.sets.map((s) => ({
      id: s.id,
      set_number: s.set_number,
      weight_kg: s.weight_kg,
      reps: s.reps,
      distance_km: s.distance_km,
      duration_seconds: s.duration_seconds,
      metrics: s.metrics ?? {},
    })),
  }));

  return (
    <div className="screen-padding flex flex-col gap-5 pb-8">
      <div className="flex items-center gap-3">
        <BackLink href={`/aktivitaet/training/${id}/zusammenfassung`} />
        <h1 className="text-xl font-bold text-neutral-900">Training bearbeiten</h1>
      </div>
      <WorkoutEditForm
        workoutId={id}
        title={workout.title ?? ''}
        date={localDateString(new Date(workout.finished_at))}
        duration={formatDuration(workout.duration_seconds ?? 0)}
        notes={workout.notes ?? ''}
        showDistance={['laufen', 'gehen', 'radfahren', 'schwimmen'].includes(workout.activity_type)}
        distanceKm={workout.distance_km}
        exercises={exercises}
      />
    </div>
  );
}
