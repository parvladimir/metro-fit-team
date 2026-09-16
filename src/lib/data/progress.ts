import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { startOfWeek } from '@/lib/date';

export type ProgressRange = '4w' | '8w' | '3m' | '6m' | '1y';

const RANGE_WEEKS: Record<ProgressRange, number> = { '4w': 4, '8w': 8, '3m': 13, '6m': 26, '1y': 52 };

export interface ProgressPoint {
  weekLabel: string;
  minutes: number;
  points: number;
  workouts: number;
  weightKg: number | null;
}

export async function getProgressSeries(userId: string, range: ProgressRange): Promise<ProgressPoint[]> {
  const supabase = await createClient();
  const weeks = RANGE_WEEKS[range];
  const rangeStart = new Date(startOfWeek());
  rangeStart.setDate(rangeStart.getDate() - (weeks - 1) * 7);

  const [{ data: workouts }, { data: measurements }] = await Promise.all([
    supabase
      .from('workouts')
      .select('finished_at, duration_seconds')
      .eq('user_id', userId)
      .eq('status', 'abgeschlossen')
      .gte('finished_at', rangeStart.toISOString()),
    supabase
      .from('body_measurements')
      .select('measured_at, weight_kg')
      .eq('user_id', userId)
      .gte('measured_at', rangeStart.toISOString().slice(0, 10))
      .order('measured_at', { ascending: true }),
  ]);

  const { data: totals } = await supabase
    .from('fitness_score_totals')
    .select('iso_year, iso_week, points')
    .eq('user_id', userId)
    .gte('updated_at', rangeStart.toISOString());

  const points: ProgressPoint[] = [];

  for (let i = 0; i < weeks; i++) {
    const weekStart = new Date(rangeStart);
    weekStart.setDate(weekStart.getDate() + i * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const weekWorkouts = (workouts ?? []).filter((w) => {
      if (!w.finished_at) return false;
      const d = new Date(w.finished_at);
      return d >= weekStart && d < weekEnd;
    });

    const isoYear = getIsoYear(weekStart);
    const isoWeek = getIsoWeek(weekStart);
    const weekTotal = (totals ?? []).find((t) => t.iso_year === isoYear && t.iso_week === isoWeek);

    const weightsInWeek = (measurements ?? []).filter((m) => {
      const d = new Date(m.measured_at);
      return d >= weekStart && d < weekEnd && m.weight_kg !== null;
    });
    const lastWeight = weightsInWeek.at(-1)?.weight_kg ?? null;

    points.push({
      weekLabel: weekStart.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
      minutes: Math.round(weekWorkouts.reduce((sum, w) => sum + (w.duration_seconds ?? 0), 0) / 60),
      points: weekTotal?.points ?? 0,
      workouts: weekWorkouts.length,
      weightKg: lastWeight,
    });
  }

  return points;
}

function getIsoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function getIsoYear(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  return d.getUTCFullYear();
}
