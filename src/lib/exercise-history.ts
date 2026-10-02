import { localDayKey } from '@/lib/date';
import { normalizeExerciseType, prefersPace } from '@/lib/exercise-types';
import {
  formatDuration,
  formatKg,
  formatKm,
  formatPace,
  formatSpeed,
  paceSecondsPerKm,
  speedKmh,
} from '@/lib/workout-metrics';
import type { ExerciseType, SetMetrics } from '@/types/database';

/** One logged set as the history functions return it. Only real, recorded values:
 * a field the user never entered is null, never 0. */
export interface HistorySet {
  set_number: number;
  weight_kg: number | null;
  reps: number | null;
  distance_km: number | null;
  duration_seconds: number | null;
  metrics: SetMetrics;
}

/** One exercise *instance* of an earlier, completed workout. The same exercise can
 * appear twice in one workout; each appearance is its own entry so unrelated set
 * groups are never merged. */
export interface HistoryEntry {
  workoutId: string;
  workoutExerciseId: string;
  performedAt: string;
  instanceNo: number;
  instanceCount: number;
  sets: HistorySet[];
}

/** What the page knows about "Letztes Mal" for one exercise. */
export type LastResultState =
  | { status: 'ok'; entry: HistoryEntry }
  | { status: 'none' }
  | { status: 'error' }
  | { status: 'hidden' };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/** Tolerant parser for the jsonb the history RPCs return — a malformed set is
 * dropped, a missing number stays null. */
export function parseHistorySets(raw: unknown): HistorySet[] {
  if (!Array.isArray(raw)) return [];
  const out: HistorySet[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const metrics = o.metrics && typeof o.metrics === 'object' && !Array.isArray(o.metrics) ? (o.metrics as SetMetrics) : {};
    out.push({
      set_number: num(o.set_number) ?? out.length + 1,
      weight_kg: num(o.weight_kg),
      reps: num(o.reps),
      distance_km: num(o.distance_km),
      duration_seconds: num(o.duration_seconds),
      metrics,
    });
  }
  return out;
}

function shortDuration(seconds: number): string {
  return seconds < 60 ? `${seconds} Sek.` : `${formatDuration(seconds)} Min.`;
}

function allEqual<T>(values: T[]): boolean {
  return values.every((v) => v === values[0]);
}

function strengthText(sets: HistorySet[]): string {
  const used = sets.filter((s) => s.weight_kg != null || s.reps != null);
  if (used.length === 0) return '';
  const weights = used.map((s) => s.weight_kg);
  const sameWeight = weights.every((w) => w != null) && allEqual(weights);
  if (sameWeight && used.every((s) => s.reps != null)) {
    return `${formatKg(weights[0]!)} · ${used.map((s) => s.reps).join(' / ')} Wdh.`;
  }
  // Different weights (or a gap): never present one weight as if it applied to every set.
  return used
    .map((s) => {
      if (s.weight_kg != null && s.reps != null) return `${formatKg(s.weight_kg)} × ${s.reps}`;
      if (s.weight_kg != null) return formatKg(s.weight_kg);
      return `${s.reps} Wdh.`;
    })
    .join(' · ');
}

function bodyweightSetText(s: HistorySet): string {
  const base = s.reps != null ? `${s.reps} Wdh.` : s.duration_seconds != null ? shortDuration(s.duration_seconds) : '';
  const extra = s.weight_kg ? `+${formatKg(s.weight_kg)}` : '';
  return [base, extra].filter(Boolean).join(' ');
}

function bodyweightText(sets: HistorySet[]): string {
  const used = sets.filter((s) => s.reps != null || s.duration_seconds != null);
  if (used.length === 0) return '';
  const extras = used.map((s) => s.weight_kg || 0);
  const extraText = extras[0] && allEqual(extras) ? ` · +${formatKg(extras[0])}` : '';
  const uniformExtra = allEqual(extras);

  if (used.every((s) => s.reps != null) && uniformExtra) return `${used.map((s) => s.reps).join(' / ')} Wdh.${extraText}`;
  if (used.every((s) => s.reps == null && s.duration_seconds != null) && uniformExtra) {
    const durations = used.map((s) => s.duration_seconds!);
    const body = allEqual(durations) && durations.length > 1 ? `${durations.length} × ${shortDuration(durations[0]!)}` : durations.map(shortDuration).join(' / ');
    return `${body}${extraText}`;
  }
  return used.map(bodyweightSetText).join(' · ');
}

function distanceCardioText(name: string, sets: HistorySet[]): string {
  const used = sets.filter((s) => s.distance_km != null || s.duration_seconds != null);
  if (used.length === 0) return '';
  const complete = (f: (s: HistorySet) => number | null) => used.every((s) => f(s) != null);
  const sum = (f: (s: HistorySet) => number | null) => used.reduce((a, s) => a + (f(s) ?? 0), 0);
  const km = complete((s) => s.distance_km) ? sum((s) => s.distance_km) : null;
  const secs = complete((s) => s.duration_seconds) ? sum((s) => s.duration_seconds) : null;
  const parts: string[] = [];
  if (km != null) parts.push(formatKm(km));
  if (secs != null) parts.push(formatDuration(secs));
  const pace = paceSecondsPerKm(secs, km);
  const speed = speedKmh(secs, km);
  if (pace && speed) parts.push(prefersPace(name) ? formatPace(pace) : formatSpeed(speed));
  if (used.length > 1) parts.push(`${used.length} Einträge`);
  return parts.join(' · ');
}

function intervalText(sets: HistorySet[]): string {
  const used = sets.filter((s) => s.metrics.rounds != null || s.metrics.work_seconds != null);
  if (used.length === 0) return '';
  const sameConfig = allEqual(used.map((s) => `${s.metrics.work_seconds ?? ''}/${s.metrics.interval_rest_seconds ?? ''}`));
  const config = (m: SetMetrics) =>
    [m.work_seconds != null ? `${m.work_seconds} Sek. Belastung` : '', m.interval_rest_seconds != null ? `${m.interval_rest_seconds} Sek. Pause` : '']
      .filter(Boolean)
      .join(' / ');
  if (sameConfig) {
    const rounds = used.map((s) => s.metrics.rounds).filter((r): r is number => r != null);
    return [rounds.length ? `${rounds.join(' + ')} Runden` : '', config(used[0]!.metrics)].filter(Boolean).join(' · ');
  }
  return used.map((s) => [s.metrics.rounds != null ? `${s.metrics.rounds} Runden` : '', config(s.metrics)].filter(Boolean).join(' · ')).join(' | ');
}

function durationOnlyText(sets: HistorySet[]): string {
  const used = sets.filter((s) => s.duration_seconds != null);
  if (used.length === 0) return '';
  const total = used.reduce((a, s) => a + s.duration_seconds!, 0);
  return used.length > 1 ? `${formatDuration(total)} · ${used.length} Einträge` : formatDuration(total);
}

/** One compact, type-aware line for "Letztes Mal" ("80 kg · 10 / 9 / 8 Wdh.").
 * Empty when the sets carry nothing to show. */
export function formatLastResult(type: ExerciseType, exerciseName: string, sets: HistorySet[]): string {
  switch (normalizeExerciseType(type)) {
    case 'strength':
      return strengthText(sets);
    case 'bodyweight':
      return bodyweightText(sets);
    case 'cardio_distance':
      return distanceCardioText(exerciseName, sets);
    case 'interval':
      return intervalText(sets);
    default:
      return durationOnlyText(sets);
  }
}

/** "28.09." for this year, "28.09.2025" otherwise — the calendar day in the app's timezone. */
export function formatHistoryDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const [y, m, day] = localDayKey(d).split('-');
  const sameYear = localDayKey(now).slice(0, 4) === y;
  return `${day}.${m}.${sameYear ? '' : y}`;
}

/** Which earlier set "Werte übernehmen" uses: the one with the same number as the set
 * about to be logged, and the last one when this session already has more sets than
 * the earlier one. Zero-based. */
export function defaultCopyIndex(previousSetCount: number, nextSetNumber: number): number {
  if (previousSetCount <= 0) return 0;
  return Math.max(0, Math.min(nextSetNumber, previousSetCount) - 1);
}

/** Short label for one earlier set (chips, the "Satz 2" picker). */
export function setChipLabel(type: ExerciseType, set: HistorySet): string {
  const t = normalizeExerciseType(type);
  const parts: string[] = [];
  if (t === 'strength') {
    if (set.weight_kg != null && set.reps != null) parts.push(`${formatKg(set.weight_kg)} × ${set.reps}`);
    else if (set.weight_kg != null) parts.push(formatKg(set.weight_kg));
    else if (set.reps != null) parts.push(`${set.reps} Wdh.`);
  } else if (t === 'bodyweight') {
    const text = bodyweightSetText(set);
    if (text) parts.push(text);
  } else if (t === 'cardio_distance') {
    if (set.distance_km != null) parts.push(formatKm(set.distance_km));
    if (set.duration_seconds != null) parts.push(formatDuration(set.duration_seconds));
  } else if (t === 'interval') {
    if (set.metrics.rounds != null) parts.push(`${set.metrics.rounds} Runden`);
    if (set.metrics.work_seconds != null) parts.push(`${set.metrics.work_seconds}/${set.metrics.interval_rest_seconds ?? 0} Sek.`);
  } else if (set.duration_seconds != null) {
    parts.push(formatDuration(set.duration_seconds));
  }
  return parts.join(' · ');
}
