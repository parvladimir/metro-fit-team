import Link from 'next/link';
import { BackLink } from '@/components/ui/BackLink';
import clsx from 'clsx';
import { requireAuthUser } from '@/lib/data/profile';
import { getProgressSeries, type ProgressRange } from '@/lib/data/progress';
import { ProgressLineChart } from '@/components/dashboard/ProgressLineChart';
import { t } from '@/lib/i18n';

// Recharts (used only by ProgressLineChart, a 'use client' component) is
// already its own chunk here since this is the only page that imports it —
// the dashboard and every other route never pull it in.

const RANGES: ProgressRange[] = ['4w', '8w', '3m', '6m', '1y'];
const METRICS = [
  { key: 'minutes', label: 'Trainingsminuten', unit: 'Min.' },
  { key: 'points', label: 'Fitness-Punkte', unit: 'Punkte' },
  { key: 'workouts', label: 'Trainings', unit: '' },
  { key: 'weightKg', label: 'Gewicht', unit: 'kg' },
] as const;

export default async function FortschrittPage({ searchParams }: { searchParams: Promise<{ range?: string; metric?: string }> }) {
  const { range: rangeParam, metric: metricParam } = await searchParams;
  const range = RANGES.includes(rangeParam as ProgressRange) ? (rangeParam as ProgressRange) : '8w';
  const metric = METRICS.find((m) => m.key === metricParam) ?? METRICS[0];

  const user = await requireAuthUser();
  const series = await getProgressSeries(user.id, range);
  const hasData = series.some((p) => (p[metric.key] ?? 0) > 0);

  return (
    <div className="screen-padding flex flex-col gap-4 pb-4">
      <div className="flex items-center gap-3">
        <BackLink href="/profil" />
        <h1 className="text-xl font-bold text-neutral-900">{t('chart.progress.title')}</h1>
      </div>

      <div className="flex gap-1.5 overflow-x-auto">
        {METRICS.map((m) => (
          <Link
            key={m.key}
            href={`/profil/fortschritt?range=${range}&metric=${m.key}`}
            className={clsx(
              'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold',
              m.key === metric.key ? 'bg-brand text-[#00232A]' : 'bg-neutral-100 text-neutral-500'
            )}
          >
            {m.label}
          </Link>
        ))}
      </div>

      <div className="card">
        {hasData ? (
          <ProgressLineChart data={series} dataKey={metric.key} unit={metric.unit} />
        ) : (
          <p className="py-10 text-center text-sm text-neutral-400">{t('chart.empty')}</p>
        )}
      </div>

      <div className="flex gap-1.5 overflow-x-auto">
        {RANGES.map((r) => (
          <Link
            key={r}
            href={`/profil/fortschritt?range=${r}&metric=${metric.key}`}
            className={clsx(
              'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold',
              r === range ? 'bg-brand text-[#00232A]' : 'bg-neutral-100 text-neutral-500'
            )}
          >
            {t(`chart.range.${r}` as const)}
          </Link>
        ))}
      </div>
    </div>
  );
}
