import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GDPR data export: returns every row the authenticated user owns, scoped
 * entirely by their own session (RLS still applies — this route has no
 * elevated privileges), as a downloadable JSON file.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  }

  const [profile, measurements, nutrition, workouts, activities, achievements, preferences, privacy] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('body_measurements').select('*').eq('user_id', user.id),
    supabase.from('nutrition_entries').select('*').eq('user_id', user.id),
    supabase.from('workouts').select('*, workout_exercises(*, workout_sets(*))').eq('user_id', user.id),
    supabase.from('activities').select('*').eq('user_id', user.id),
    supabase.from('user_achievements').select('*').eq('user_id', user.id),
    supabase.from('user_metric_preferences').select('*').eq('user_id', user.id),
    supabase.from('privacy_settings').select('*').eq('user_id', user.id),
  ]);

  const exportPayload = {
    exportedAt: new Date().toISOString(),
    profile: profile.data,
    bodyMeasurements: measurements.data,
    nutritionEntries: nutrition.data,
    workouts: workouts.data,
    activities: activities.data,
    achievements: achievements.data,
    metricPreferences: preferences.data,
    privacySettings: privacy.data,
  };

  return new NextResponse(JSON.stringify(exportPayload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="meine-daten-${user.id}.json"`,
    },
  });
}
