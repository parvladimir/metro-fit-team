import { BackLink } from '@/components/ui/BackLink';
import { createClient } from '@/lib/supabase/server';
import { requireAuthUser } from '@/lib/data/profile';
import { updateNotificationPreferencesAction, deleteAccountAction } from '../actions';
import { ConfirmSubmitButton } from '@/components/ui/ConfirmSubmitButton';
import { t } from '@/lib/i18n';
import { DEFAULT_ON_CATEGORIES, OPT_IN_CATEGORIES } from '@/lib/notification-gating';
import type { NotificationPreferences } from '@/types/database';

export default async function EinstellungenPage() {
  const user = await requireAuthUser();
  const supabase = await createClient();
  const { data } = await supabase.from('notification_preferences').select('*').eq('user_id', user.id).single();
  const prefs = data as NotificationPreferences;

  return (
    <div className="screen-padding flex flex-col gap-5 pb-8">
      <div className="flex items-center gap-3">
        <BackLink href="/profil" />
        <h1 className="text-xl font-bold text-neutral-900">{t('profile.appSettings')}</h1>
      </div>

      <section>
        <p className="section-title mb-2">{t('notification.settings.title')}</p>
        <p className="mb-3 text-xs text-neutral-500">{t('notification.settings.description')}</p>
        <form action={updateNotificationPreferencesAction} className="flex flex-col gap-2">
          {DEFAULT_ON_CATEGORIES.map((cat) => (
            <label key={cat} className="card flex items-center justify-between py-3">
              <span className="text-sm font-medium text-neutral-800">{t(`notification.category.${cat}` as const)}</span>
              <input type="checkbox" name={cat} defaultChecked={prefs?.[cat] ?? true} className="h-5 w-5 accent-brand" />
            </label>
          ))}

          <div className="mt-2 flex flex-col gap-2 border-t border-white/[0.08] pt-4">
            <div>
              <p className="label mb-1">Optional – standardmäßig aus</p>
              <p className="text-xs text-neutral-500">
                Nur wenn du das möchtest: Einladungen zu Freundschaftsduellen und zu gemeinsamen Trainings.
              </p>
            </div>
            {OPT_IN_CATEGORIES.map((cat) => (
              <label key={cat} className="card flex items-center justify-between py-3">
                <span className="text-sm font-medium text-neutral-800">{t(`notification.category.${cat}` as const)}</span>
                {/* `=== true`, not `?? true`: these are off unless explicitly switched on. */}
                <input type="checkbox" name={cat} defaultChecked={prefs?.[cat] === true} className="h-5 w-5 accent-brand" />
              </label>
            ))}
          </div>

          <div className="mt-2 border-t border-white/[0.08] pt-4">
            <p className="label mb-1">Ruhezeiten</p>
            <p className="mb-2 text-xs text-neutral-500">Push-Benachrichtigungen pausieren in diesem Zeitfenster (täglich).</p>
            <div className="grid grid-cols-2 gap-3">
              <input type="time" name="quietHoursStart" defaultValue={prefs?.quiet_hours_start?.slice(0, 5) ?? ''} className="input-field" />
              <input type="time" name="quietHoursEnd" defaultValue={prefs?.quiet_hours_end?.slice(0, 5) ?? ''} className="input-field" />
            </div>
            <p className="mt-1 text-[11px] text-neutral-500">Beide leer lassen, um Ruhezeiten zu deaktivieren.</p>
          </div>

          <div className="mt-2 border-t border-white/[0.08] pt-4">
            <label className="card flex items-center justify-between py-3">
              <span className="text-sm font-medium text-neutral-800">Motivation pausieren</span>
              <input
                type="checkbox"
                name="motivationPaused"
                defaultChecked={!!prefs?.motivation_paused_until && new Date(prefs.motivation_paused_until) > new Date()}
                className="h-5 w-5 accent-brand"
              />
            </label>
            <p className="mb-2 text-xs text-neutral-500">
              Betrifft nur Erinnerungen und Wochenrückblicke — Antworten und Erwähnungen kommen weiterhin direkt an.
            </p>
            <label className="label" htmlFor="motivationResumeDate">Bis wann (optional)</label>
            <input
              id="motivationResumeDate"
              name="motivationResumeDate"
              type="date"
              defaultValue={prefs?.motivation_paused_until ? prefs.motivation_paused_until.slice(0, 10) : ''}
              className="input-field"
            />
            <p className="mt-1 text-[11px] text-neutral-500">Ohne Datum: automatisch 4 Wochen.</p>
          </div>

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
          <ConfirmSubmitButton className="btn-destructive w-full" confirmMessage={t('profile.deleteAccount.confirm')}>
            {t('profile.deleteAccount')}
          </ConfirmSubmitButton>
        </form>
      </section>
    </div>
  );
}
