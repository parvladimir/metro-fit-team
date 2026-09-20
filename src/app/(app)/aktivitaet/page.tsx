import Link from 'next/link';
import clsx from 'clsx';
import { Dumbbell, Ruler, ClipboardList, ChevronRight, Lock, CheckCircle2, Play, CircleDashed } from 'lucide-react';
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
      <h1 className="text-page-title text-neutral-900">{t('nav.activity')}</h1>

      <div className="segmented">
        <TabLink href="/aktivitaet?tab=trainings" active={activeTab === 'trainings'} label={t('workout.new')} />
        <TabLink href="/aktivitaet?tab=messungen" active={activeTab === 'messungen'} label={t('measurement.title')} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/aktivitaet/training/neu" className="btn-primary">
          <Dumbbell size={17} strokeWidth={2} />
          {t('nav.startWorkout')}
        </Link>
        <Link href="/aktivitaet/messung/neu" className="btn-secondary">
          <Ruler size={17} strokeWidth={2} className="shrink-0 text-accent-info" />
          {t('measurement.add')}
        </Link>
      </div>
      <Link href="/aktivitaet/protokoll" className="btn-ghost w-full !border-white/[0.08] bg-surface-1">
        <ClipboardList size={16} strokeWidth={2} />
        {t('workout.log.title')}
      </Link>

      {activeTab === 'trainings' ? <WorkoutList userId={user.id} /> : <MeasurementList userId={user.id} />}
    </div>
  );
}

function TabLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={clsx('segmented-item', active && 'segmented-item-active')}
    >
      {label}
    </Link>
  );
}

async function WorkoutList({ userId }: { userId: string }) {
  const workouts = await getRecentWorkouts(userId);

  if (workouts.length === 0) {
    return <EmptyState title={t('workout.empty.title')} actionLabel={t('workout.empty.action')} actionHref="/aktivitaet/training/neu" icon={Dumbbell} />;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {workouts.map((w) => (
        <Link
          key={w.id}
          href={w.status === 'abgeschlossen' ? `/aktivitaet/training/${w.id}/zusammenfassung` : `/aktivitaet/training/${w.id}`}
          className="list-row justify-between"
        >
          <span
            className={`icon-chip h-10 w-10 ${
              w.status === 'abgeschlossen' ? 'accent-success' : w.status === 'laeuft' ? 'accent-primary' : '!border-white/10 !bg-neutral-150/60 !text-neutral-500'
            }`}
          >
            {w.status === 'abgeschlossen' ? <CheckCircle2 size={18} strokeWidth={2} /> : w.status === 'laeuft' ? <Play size={17} strokeWidth={2} /> : <CircleDashed size={18} strokeWidth={2} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-neutral-900">{w.title || t(`activityType.${w.activity_type}` as const)}</p>
            <p className="text-xs text-neutral-500">
              {[
                formatGermanDate(w.scheduled_date),
                t(`workout.status.${w.status}` as const),
                w.duration_seconds ? `${Math.round(w.duration_seconds / 60)} Min.` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <ChevronRight size={18} className="shrink-0 text-neutral-400" />
        </Link>
      ))}
    </div>
  );
}

async function MeasurementList({ userId }: { userId: string }) {
  const measurements = await getMeasurementHistory(userId);

  if (measurements.length === 0) {
    return <EmptyState title={t('measurement.empty.title')} actionLabel={t('measurement.empty.action')} actionHref="/aktivitaet/messung/neu" icon={Ruler} />;
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="flex items-center gap-1.5 text-xs text-neutral-400">
        <Lock size={12} strokeWidth={2} />
        {t('measurement.private.notice')}
      </p>
      {measurements.map((m) => (
        <div key={m.id} className="card accent-info flex items-center gap-3 !py-3.5">
          <span className="icon-chip h-10 w-10">
            <Ruler size={17} strokeWidth={2} />
          </span>
          <p className="flex-1 text-sm font-semibold text-neutral-900">{formatGermanDate(m.measured_at)}</p>
          <p className="text-sm font-semibold tabular-nums text-neutral-700">{m.weight_kg ? `${m.weight_kg} kg` : '—'}</p>
        </div>
      ))}
    </div>
  );
}
