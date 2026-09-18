import type { ExerciseType } from '@/types/database';
import { normalizeExerciseType } from '@/lib/exercise-types';
import { formatDuration, formatKg, formatKm, parseDuration, type SetLike } from '@/lib/workout-metrics';

/** Optional planned values for one exercise. Guidance only — never enforced. */
export interface PlannedTargets {
  sets?: number;
  reps?: number;
  weightKg?: number;
  durationSeconds?: number;
  distanceKm?: number;
  rounds?: number;
  workSeconds?: number;
  restSeconds?: number;
}

type BaseType = Exclude<ExerciseType, 'cardio'>;

/** "Erfasst im Training" line per exercise type. */
const TRACKING: Record<BaseType, string> = {
  strength: 'Sätze · Wiederholungen · Gewicht',
  bodyweight: 'Wiederholungen oder Dauer · optional Zusatzgewicht',
  cardio_distance: 'Zeit · Distanz · Pace · Ø Geschwindigkeit',
  cardio_time: 'Dauer',
  interval: 'Runden · Belastungszeit · Pause',
  mobility: 'Dauer',
  sport: 'Dauer · optional weitere Daten',
  other: 'Dauer',
};

export function trackingDescription(type: ExerciseType): string {
  return TRACKING[normalizeExerciseType(type)];
}

export type TargetFieldKey = 'sets' | 'reps' | 'duration' | 'weight' | 'distance' | 'rounds' | 'work' | 'rest';

/** Which optional target inputs apply to a type (bodyweight: reps OR duration). */
export function targetFieldsFor(type: ExerciseType, bodyweightMode: 'reps' | 'duration' = 'reps'): TargetFieldKey[] {
  switch (normalizeExerciseType(type)) {
    case 'strength':
      return ['sets', 'reps', 'weight'];
    case 'bodyweight':
      return bodyweightMode === 'reps' ? ['sets', 'reps', 'weight'] : ['sets', 'duration', 'weight'];
    case 'cardio_distance':
      return ['duration', 'distance'];
    case 'interval':
      return ['rounds', 'work', 'rest'];
    default:
      return ['duration'];
  }
}

function num(raw: FormDataEntryValue | null, min: number, max: number, int: boolean): number | undefined {
  const s = String(raw ?? '').trim().replace(',', '.');
  if (!s) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return int ? Math.round(n) : Math.round(n * 100) / 100;
}

/** Parse optional target inputs; invalid or empty values are dropped (never required). */
export function parseTargets(type: ExerciseType, form: FormData): PlannedTargets {
  const mode = form.get('targetMode') === 'duration' ? 'duration' : 'reps';
  const out: PlannedTargets = {};
  for (const key of targetFieldsFor(type, mode)) {
    if (key === 'sets') out.sets = num(form.get('targetSets'), 1, 50, true);
    if (key === 'reps') out.reps = num(form.get('targetReps'), 1, 1000, true);
    if (key === 'weight') out.weightKg = num(form.get('targetWeight'), 0, 1000, false);
    if (key === 'distance') out.distanceKm = num(form.get('targetDistance'), 0.01, 1000, false);
    if (key === 'rounds') out.rounds = num(form.get('targetRounds'), 1, 200, true);
    if (key === 'work') out.workSeconds = num(form.get('targetWork'), 1, 3600, true);
    if (key === 'rest') out.restSeconds = num(form.get('targetRest'), 0, 3600, true);
    if (key === 'duration') {
      const d = parseDuration(String(form.get('targetDuration') ?? ''));
      if (d && d > 0 && d <= 86400) out.durationSeconds = d;
    }
  }
  return stripEmpty(out);
}

function stripEmpty(t: PlannedTargets): PlannedTargets {
  return Object.fromEntries(Object.entries(t).filter(([, v]) => v != null)) as PlannedTargets;
}

export function hasTargets(t: PlannedTargets | null | undefined): boolean {
  return !!t && Object.keys(stripEmpty(t)).length > 0;
}

/** DB columns for a plan exercise row. */
export function targetsToColumns(t: PlannedTargets) {
  const metrics: Record<string, number> = {};
  if (t.rounds != null) metrics.rounds = t.rounds;
  if (t.workSeconds != null) metrics.work_seconds = t.workSeconds;
  if (t.restSeconds != null) metrics.rest_seconds = t.restSeconds;
  return {
    target_sets: t.sets ?? null,
    target_reps: t.reps ?? null,
    target_weight_kg: t.weightKg ?? null,
    target_duration_seconds: t.durationSeconds ?? null,
    target_distance_km: t.distanceKm ?? null,
    target_metrics: metrics,
  };
}

export interface PlanTargetRow {
  target_sets?: number | null;
  target_reps?: number | null;
  target_weight_kg?: number | string | null;
  target_duration_seconds?: number | null;
  target_distance_km?: number | string | null;
  target_metrics?: { rounds?: number; work_seconds?: number; rest_seconds?: number } | null;
}

/** Row → targets. Legacy rows (only sets/reps) work unchanged. */
export function targetsFromRow(type: ExerciseType, row: PlanTargetRow): PlannedTargets {
  const m = row.target_metrics ?? {};
  const all: PlannedTargets = {
    sets: row.target_sets ?? undefined,
    reps: row.target_reps ?? undefined,
    weightKg: row.target_weight_kg != null ? Number(row.target_weight_kg) : undefined,
    durationSeconds: row.target_duration_seconds ?? undefined,
    distanceKm: row.target_distance_km != null ? Number(row.target_distance_km) : undefined,
    rounds: m.rounds,
    workSeconds: m.work_seconds,
    restSeconds: m.rest_seconds,
  };
  // Only keep what is meaningful for this type (legacy cardio rows had none).
  const keep = new Set(targetFieldsFor(type, all.durationSeconds && !all.reps ? 'duration' : 'reps'));
  const out: PlannedTargets = {};
  if (keep.has('sets')) out.sets = all.sets;
  if (keep.has('reps')) out.reps = all.reps;
  if (keep.has('weight')) out.weightKg = all.weightKg;
  if (keep.has('duration')) out.durationSeconds = all.durationSeconds;
  if (keep.has('distance')) out.distanceKm = all.distanceKm;
  if (keep.has('rounds')) out.rounds = all.rounds;
  if (keep.has('work')) out.workSeconds = all.workSeconds;
  if (keep.has('rest')) out.restSeconds = all.restSeconds;
  return stripEmpty(out);
}

export function formatPlanDuration(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60} Min.` : `${formatDuration(seconds)} Min.`;
}

/** Compact one-line German summary, e.g. "3 × 10 · 80 kg". Empty when no targets. */
export function formatTargets(type: ExerciseType, t: PlannedTargets): string {
  const kind = normalizeExerciseType(type);
  const parts: string[] = [];
  if (kind === 'strength' || kind === 'bodyweight') {
    const amount = t.reps != null ? `${t.reps}` : t.durationSeconds != null ? formatPlanDuration(t.durationSeconds) : null;
    if (t.sets != null && amount) parts.push(`${t.sets} × ${amount}`);
    else if (t.sets != null) parts.push(`${t.sets} Sätze`);
    else if (amount) parts.push(t.reps != null ? `${amount} Wdh.` : amount);
    if (t.weightKg) parts.push(kind === 'bodyweight' ? `+${formatKg(t.weightKg)}` : formatKg(t.weightKg));
  } else if (kind === 'cardio_distance') {
    if (t.distanceKm != null) parts.push(formatKm(t.distanceKm));
    if (t.durationSeconds != null) parts.push(formatPlanDuration(t.durationSeconds));
  } else if (kind === 'interval') {
    if (t.rounds != null) parts.push(`${t.rounds} Runden`);
    if (t.workSeconds != null && t.restSeconds != null) parts.push(`${t.workSeconds}/${t.restSeconds} Sek.`);
    else if (t.workSeconds != null) parts.push(`${t.workSeconds} Sek. Belastung`);
    else if (t.restSeconds != null) parts.push(`${t.restSeconds} Sek. Pause`);
  } else if (t.durationSeconds != null) {
    parts.push(formatPlanDuration(t.durationSeconds));
  }
  return parts.join(' · ');
}

/** What was actually logged, in the same shape as the plan summary. */
export function formatAchieved(type: ExerciseType, sets: SetLike[]): string {
  if (sets.length === 0) return '';
  const kind = normalizeExerciseType(type);
  const sum = (f: (s: SetLike) => number | null | undefined) => sets.reduce((a, s) => a + (f(s) ?? 0), 0);
  const parts: string[] = [];
  if (kind === 'strength' || kind === 'bodyweight') {
    parts.push(`${sets.length} ${sets.length === 1 ? 'Satz' : 'Sätze'}`);
    const reps = sets.filter((s) => s.reps != null).map((s) => s.reps);
    if (reps.length) parts.push(`${reps.join(' / ')} Wdh.`);
    const secs = sum((s) => s.duration_seconds);
    if (!reps.length && secs) parts.push(formatDuration(secs));
    const top = Math.max(...sets.map((s) => s.weight_kg ?? 0));
    if (top > 0) parts.push(formatKg(top));
  } else if (kind === 'cardio_distance') {
    const km = sum((s) => s.distance_km);
    const secs = sum((s) => s.duration_seconds);
    if (km) parts.push(formatKm(km));
    if (secs) parts.push(formatDuration(secs));
  } else if (kind === 'interval') {
    const rounds = sum((s) => s.metrics.rounds);
    if (rounds) parts.push(`${rounds} Runden`);
    const w = sets.find((s) => s.metrics.work_seconds != null)?.metrics;
    if (w?.work_seconds != null) parts.push(`${w.work_seconds}/${w.interval_rest_seconds ?? 0} Sek.`);
  } else {
    const secs = sum((s) => s.duration_seconds);
    if (secs) parts.push(formatDuration(secs));
  }
  return parts.join(' · ');
}
