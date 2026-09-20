import { BackLink } from '@/components/ui/BackLink';
import { createClient } from '@/lib/supabase/server';
import { requireAuthUser } from '@/lib/data/profile';
import { updatePrivacySettingsAction } from '../actions';
import { t } from '@/lib/i18n';
import type { PrivacySettings } from '@/types/database';

export default async function DatenschutzPage() {
  const user = await requireAuthUser();
  const supabase = await createClient();
  const { data: settings } = await supabase.from('privacy_settings').select('*').eq('user_id', user.id).single();
  const privacy = settings as PrivacySettings;

  return (
    <div className="screen-padding flex flex-col gap-4 pb-8">
      <div className="flex items-center gap-3">
        <BackLink href="/profil" />
        <h1 className="text-xl font-bold text-neutral-900">{t('privacy.title')}</h1>
      </div>

      <p className="rounded-xl border border-white/[0.06] bg-surface-1 px-4 py-3 text-xs text-neutral-600">{t('privacy.description')}</p>

      <form action={updatePrivacySettingsAction} className="flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="bodyMeasurementsVisibility">{t('privacy.bodyMeasurements')}</label>
          <select id="bodyMeasurementsVisibility" name="bodyMeasurementsVisibility" defaultValue={privacy.body_measurements_visibility} className="input-field">
            <option value="private">{t('privacy.visibility.private')}</option>
            <option value="team">{t('privacy.visibility.team')}</option>
            <option value="selected">{t('privacy.visibility.selected')}</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="nutritionVisibility">{t('privacy.nutrition')}</label>
          <select id="nutritionVisibility" name="nutritionVisibility" defaultValue={privacy.nutrition_visibility} className="input-field">
            <option value="private">{t('privacy.visibility.private')}</option>
            <option value="team">{t('privacy.visibility.team')}</option>
            <option value="selected">{t('privacy.visibility.selected')}</option>
          </select>
        </div>
        <label className="card flex items-center justify-between">
          <span className="text-sm font-medium text-neutral-800">{t('privacy.activityFeedOptIn')}</span>
          <input type="checkbox" name="activityFeedOptIn" defaultChecked={privacy.activity_feed_opt_in} className="h-5 w-5 accent-brand" />
        </label>

        <button type="submit" className="btn-primary">{t('common.saveChanges')}</button>
      </form>
    </div>
  );
}
