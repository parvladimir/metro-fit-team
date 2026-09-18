import Link from 'next/link';
import clsx from 'clsx';
import { requireAuthUser } from '@/lib/data/profile';
import { getRecentWorkouts } from '@/lib/data/workouts';
import { getMeasurementHistory } from '@/lib/data/measurements';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatGermanDate } from '@/lib/date';
import { t } from '@/lib/i18n';

export default async function AktivitaetPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const activeTab = tab === 'messungen' ? 'messungen' : 'trainings';
  const user = await requireAuthUser();

  return (
    <div className="screen-padding flex flex-col gap-4 pb-4">
      <h1 className="text-2xl font-bold text-neutral-900">{t('nav.activity')}</h1>

      <div className="flex gap-2 rounded-2xl bg-neutral-100 p-1">
        <TabLink href="/aktivitaet?tab=trainings" active={activeTab === 'trainings'} label={t('workout.new')} />
        <TabLink href="/aktivitaet?tab=messungen" active={activeTab === 'messungen'} label={t('measurement.title')} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/aktivitaet/training/neu" className="btn-primary">{t('nav.startWorkout')}</Link>
        <Link href="/aktivitaet/messung/neu" className="btn-secondary">{t('measurement.add')}</Link>
      </div>
      <Link href="/aktivitaet/protokoll" className="btn-ghost bg-neutral-100">{t('workout.log.title')}</Link>

      {activeTab === 'trainings' ? <WorkoutList userId={user.id} /> : <MeasurementList userId={user.id} />}
    </div>
  );
}

function TabLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={clsx(
        'flex-1 rounded-xl py-2 text-center text-sm font-semibold transition',
        active ? 'bg-neutral-100 text-neutral-900 shadow-sm' : 'text-neutral-500'
      )}
    >
      {label}
    </Link>
  );
}

async function WorkoutList({ userId }: { userId: string }) {
  const workouts = await getRecentWorkouts(userId);

  if (workouts.length === 0) {
    return <EmptyState title={t('workout.empty.title')} actionLabel={t('workout.empty.action')} actionHref="/aktivitaet/training/neu" icon="🏋️" />;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {workouts.map((w) => (
        <Link
          key={w.id}
          href={w.status === 'abgeschlossen' ? `/aktivitaet/training/${w.id}/zusammenfassung` : `/aktivitaet/training/${w.id}`}
          className="card flex items-center justify-between py-3.5"
        >
          <div>
            <p className="text-sm font-semibold text-neutral-900">{w.title || t(`activityType.${w.activity_type}` as const)}</p>
            <p className="text-xs text-neutral-500">
              {formatGermanDate(w.scheduled_date)} · {t(`workout.status.${w.status}` as const)}
              {w.duration_seconds ? ` · ${Math.round(w.duration_seconds / 60)} Min.` : ''}
            </p>
          </div>
          <span className="text-neutral-300">›</span>
        </Link>
      ))}
    </div>
  );
}

async function MeasurementList({ userId }: { userId: string }) {
  const measurements = await getMeasurementHistory(userId);

  if (measurements.length === 0) {
    return <EmptyState title={t('measurement.empty.title')} actionLabel={t('measurement.empty.action')} actionHref="/aktivitaet/messung/neu" icon="📏" />;
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-xs text-neutral-400">{t('measurement.private.notice')} 🔒</p>
      {measurements.map((m) => (
        <div key={m.id} className="card flex items-center justify-between py-3.5">
          <p className="text-sm font-semibold text-neutral-900">{formatGermanDate(m.measured_at)}</p>
          <p className="text-sm text-neutral-600">{m.weight_kg ? `${m.weight_kg} kg` : '—'}</p>
        </div>
      ))}
    </div>
  );
}
