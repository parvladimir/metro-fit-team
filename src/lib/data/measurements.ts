import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { BodyMeasurement } from '@/types/database';

export async function getMeasurementHistory(userId: string, limit = 52): Promise<BodyMeasurement[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('body_measurements')
    .select('*')
    .eq('user_id', userId)
    .order('measured_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as BodyMeasurement[];
}

export const MEASUREMENT_FIELDS = [
  { key: 'weight_kg', labelKey: 'measurement.weight', unit: 'kg' },
  { key: 'biceps_cm', labelKey: 'measurement.biceps', unit: 'cm' },
  { key: 'waist_cm', labelKey: 'measurement.waist', unit: 'cm' },
  { key: 'chest_cm', labelKey: 'measurement.chest', unit: 'cm' },
  { key: 'hip_cm', labelKey: 'measurement.hip', unit: 'cm' },
  { key: 'thigh_cm', labelKey: 'measurement.thigh', unit: 'cm' },
  { key: 'body_fat_pct', labelKey: 'measurement.bodyFat', unit: '%' },
  { key: 'neck_cm', labelKey: 'measurement.neck', unit: 'cm' },
] as const;
