import type { ExerciseType, SetMetrics } from '@/types/database';
import { normalizeExerciseType } from '@/lib/exercise-types';

/** "42:30" → 2550, "1:15:00" → 4500, "45" → 45 min? No: a bare number is minutes. */
export function parseDuration(input: string): number | null {
  const value = input.trim().replace(',', '.');
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value)) return Math.round(parseFloat(value) * 60); // bare number = minutes
  const parts = value.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  const [h, m, s] = nums.length === 3 ? nums : [0, nums[0]!, nums[1]!];
  if (m! > 59 && nums.length === 3) return null;
  if (s! > 59) return null;
  return h! * 3600 + m! * 60 + s!;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** Seconds per km, or null when it cannot be computed. */
export function paceSecondsPerKm(durationSeconds: number | null, distanceKm: number | null): number | null {
  if (!durationSeconds || !distanceKm || durationSeconds <= 0 || distanceKm <= 0) return null;
  return durationSeconds / distanceKm;
}

export function formatPace(secondsPerKm: number): string {
  let m = Math.floor(secondsPerKm / 60);
  let s = Math.round(secondsPerKm % 60);
  if (s === 60) {
    m += 1;
    s = 0;
  }
  return `${m}:${String(s).padStart(2, '0')} min/km`;
}

export function speedKmh(durationSeconds: number | null, distanceKm: number | null): number | null {
  if (!durationSeconds || !distanceKm || durationSeconds <= 0 || distanceKm <= 0) return null;
  return distanceKm / (durationSeconds / 3600);
}

export function formatSpeed(kmh: number): string {
  return `${kmh.toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} km/h`;
}

export function formatKm(km: number): string {
  return `${km.toLocaleString('de-DE', { maximumFractionDigits: 2 })} km`;
}

export function formatKg(kg: number): string {
  return `${kg.toLocaleString('de-DE', { maximumFractionDigits: 2 })} kg`;
}

export interface SetLike {
  weight_kg: number | null;
  reps: number | null;
  distance_km: number | null;
  duration_seconds: number | null;
  metrics: SetMetrics;
}

/** One-line, type-aware summary of a logged set (German). */
export function summarizeSet(type: ExerciseType, set: SetLike): string {
  const t = normalizeExerciseType(type);
  const parts: string[] = [];

  if (t === 'strength') {
    if (set.weight_kg != null) parts.push(formatKg(set.weight_kg));
    if (set.reps != null) parts.push(`${set.reps} Wdh.`);
    if (set.metrics.rpe != null) parts.push(`RPE ${set.metrics.rpe}`);
  } else if (t === 'bodyweight') {
    if (set.reps != null) parts.push(`${set.reps} Wdh.`);
    if (set.duration_seconds != null) parts.push(formatDuration(set.duration_seconds));
    if (set.weight_kg) parts.push(`+${formatKg(set.weight_kg)}`);
  } else if (t === 'cardio_distance') {
    if (set.duration_seconds != null) parts.push(formatDuration(set.duration_seconds));
    if (set.distance_km != null) parts.push(formatKm(set.distance_km));
    const pace = paceSecondsPerKm(set.duration_seconds, set.distance_km);
    const speed = speedKmh(set.duration_seconds, set.distance_km);
    if (pace) parts.push(`Pace ${formatPace(pace)}`);
    if (speed) parts.push(`Ø ${formatSpeed(speed)}`);
  } else if (t === 'interval') {
    if (set.metrics.rounds != null) parts.push(`${set.metrics.rounds} Runden`);
    if (set.metrics.work_seconds != null) parts.push(`${set.metrics.work_seconds} Sek. Belastung`);
    if (set.metrics.interval_rest_seconds != null) parts.push(`${set.metrics.interval_rest_seconds} Sek. Pause`);
  } else if (set.duration_seconds != null) {
    parts.push(formatDuration(set.duration_seconds));
  }

  if (set.metrics.calories != null) parts.push(`${set.metrics.calories} kcal`);
  if (set.metrics.avg_heart_rate != null) parts.push(`Ø ${set.metrics.avg_heart_rate} bpm`);
  return parts.join(' · ') || '—';
}
