'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAuthUser } from '@/lib/data/profile';

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

export async function updateNotificationPreferencesAction(formData: FormData) {
  const user = await requireAuthUser();
  const supabase = await createClient();

  const categories = ['trainingserinnerung', 'wochenziel', 'messungserinnerung', 'herausforderung', 'team_aktivitaet', 'wochenzusammenfassung'];
  const payload = Object.fromEntries(categories.map((c) => [c, formData.get(c) === 'on']));

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
