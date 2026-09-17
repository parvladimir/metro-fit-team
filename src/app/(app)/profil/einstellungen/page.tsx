import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireAuthUser } from '@/lib/data/profile';
import { updateNotificationPreferencesAction, deleteAccountAction } from '../actions';
import { ConfirmSubmitButton } from '@/components/ui/ConfirmSubmitButton';
import { t } from '@/lib/i18n';
import type { NotificationPreferences } from '@/types/database';

const CATEGORIES = ['trainingserinnerung', 'wochenziel', 'messungserinnerung', 'herausforderung', 'team_aktivitaet', 'wochenzusammenfassung'] as const;

export default async function EinstellungenPage() {
  const user = await requireAuthUser();
  const supabase = await createClient();
  const { data } = await supabase.from('notification_preferences').select('*').eq('user_id', user.id).single();
  const prefs = data as NotificationPreferences;

  return (
    <div className="screen-padding flex flex-col gap-5 pb-8">
      <div className="flex items-center gap-3">
        <Link href="/profil" className="text-2xl text-neutral-400">‹</Link>
        <h1 className="text-xl font-bold text-neutral-900">{t('profile.appSettings')}</h1>
      </div>

      <section>
        <p className="section-title mb-2">{t('notification.settings.title')}</p>
        <p className="mb-3 text-xs text-neutral-500">{t('notification.settings.description')}</p>
        <form action={updateNotificationPreferencesAction} className="flex flex-col gap-2">
          {CATEGORIES.map((cat) => (
            <label key={cat} className="card flex items-center justify-between py-3">
              <span className="text-sm font-medium text-neutral-800">{t(`notification.category.${cat}` as const)}</span>
              <input type="checkbox" name={cat} defaultChecked={prefs?.[cat] ?? true} className="h-5 w-5 accent-brand" />
            </label>
          ))}
          <button type="submit" className="btn-primary mt-2">{t('common.saveChanges')}</button>
        </form>
      </section>

      <section className="flex flex-col gap-2">
        <p className="section-title">{t('profile.dataExport')}</p>
        <a href="/api/account/export" className="btn-secondary">{t('profile.dataExport')}</a>
      </section>

      <section className="flex flex-col gap-2">
        <p className="section-title text-red-500">{t('profile.deleteAccount')}</p>
        <form action={deleteAccountAction}>
          <ConfirmSubmitButton className="btn-ghost w-full bg-red-500/15 text-red-400" confirmMessage={t('profile.deleteAccount.confirm')}>
            {t('profile.deleteAccount')}
          </ConfirmSubmitButton>
        </form>
      </section>
    </div>
  );
}
