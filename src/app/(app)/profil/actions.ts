'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAuthUser } from '@/lib/data/profile';

export async function updateProfileAction(formData: FormData) {
  const user = await requireAuthUser();
  const supabase = await createClient();

  const fullName = String(formData.get('fullName') || '').trim();
  const fitnessGoal = String(formData.get('fitnessGoal') || '');
  const weeklyGoal = Number(formData.get('weeklyGoal') || 3);

  if (!fullName) return;

  await supabase
    .from('profiles')
    .update({
      full_name: fullName,
      fitness_goal: fitnessGoal || null,
      weekly_goal: Math.min(7, Math.max(1, weeklyGoal)),
    })
    .eq('id', user.id);

  revalidatePath('/profil');
  revalidatePath('/profil/bearbeiten');
  redirect('/profil');
}

export async function updatePrivacySettingsAction(formData: FormData) {
  const user = await requireAuthUser();
  const supabase = await createClient();

  await supabase
    .from('privacy_settings')
    .update({
      body_measurements_visibility: String(formData.get('bodyMeasurementsVisibility') || 'private'),
      nutrition_visibility: String(formData.get('nutritionVisibility') || 'private'),
      activity_feed_opt_in: formData.get('activityFeedOptIn') === 'on',
    })
    .eq('user_id', user.id);

  revalidatePath('/profil/datenschutz');
}

const DEFAULT_MOTIVATION_PAUSE_DAYS = 28;

export async function updateNotificationPreferencesAction(formData: FormData) {
  const user = await requireAuthUser();
  const supabase = await createClient();

  const categories = ['trainingserinnerung', 'wochenziel', 'messungserinnerung', 'herausforderung', 'team_aktivitaet', 'wochenzusammenfassung', 'chat_nachrichten', 'reaktionen_antworten', 'erwaehnungen'];
  const payload: Record<string, boolean | string | null> = Object.fromEntries(categories.map((c) => [c, formData.get(c) === 'on']));

  // Quiet hours: both-or-neither, so a half-filled pair never persists.
  const quietStart = String(formData.get('quietHoursStart') || '').trim();
  const quietEnd = String(formData.get('quietHoursEnd') || '').trim();
  payload.quiet_hours_start = quietStart && quietEnd ? quietStart : null;
  payload.quiet_hours_end = quietStart && quietEnd ? quietEnd : null;

  // Motivation pause: no chosen resume date defaults to 4 weeks out, so the
  // column stays a single nullable timestamp with no sentinel "forever" value.
  if (formData.get('motivationPaused') === 'on') {
    const resumeDate = String(formData.get('motivationResumeDate') || '').trim();
    const resumeAt = resumeDate ? new Date(`${resumeDate}T23:59:59`) : new Date(Date.now() + DEFAULT_MOTIVATION_PAUSE_DAYS * 24 * 60 * 60 * 1000);
    payload.motivation_paused_until = resumeAt.toISOString();
  } else {
    payload.motivation_paused_until = null;
  }

  await supabase.from('notification_preferences').update(payload).eq('user_id', user.id);
  revalidatePath('/profil/einstellungen');
}

export async function updateMetricPreferencesAction(formData: FormData) {
  const user = await requireAuthUser();
  const supabase = await createClient();

  const enabledMetrics = formData.getAll('enabledMetrics').map(String);

  await supabase
    .from('user_metric_preferences')
    .update({
      enabled_metrics: enabledMetrics,
      steps_goal: Number(formData.get('stepsGoal') || 10000),
      calorie_goal_kcal: formData.get('calorieGoal') ? Number(formData.get('calorieGoal')) : null,
    })
    .eq('user_id', user.id);

  revalidatePath('/profil/metriken');
}

/**
 * Deletes the caller's own account permanently. Only ever operates on
 * `user.id` from the caller's own verified session — never on an id
 * supplied by the client — so this cannot be used to delete anyone else's
 * account no matter what a crafted request contains.
 */
export async function deleteAccountAction() {
  'use server';
  const user = await requireAuthUser();
  const admin = createAdminClient();
  await admin.auth.admin.deleteUser(user.id);

  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/anmelden');
}
