import Link from 'next/link';
import { requireTeamAdminMembership } from '@/lib/data/admin';
import { updateTeamSettingsAction } from './actions';
import { t } from '@/lib/i18n';

export default async function TeamEinstellungenPage() {
  const admin = await requireTeamAdminMembership();

  return (
    <div className="screen-padding flex flex-col gap-4 pb-8">
      <div className="flex items-center gap-3">
        <Link href="/team/verwalten" className="text-2xl text-neutral-400">‹</Link>
        <h1 className="text-xl font-bold text-neutral-900">{t('admin.teamSettings')}</h1>
      </div>

      <form action={updateTeamSettingsAction} className="flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="name">{t('admin.teamName')}</label>
          <input id="name" name="name" defaultValue={admin.team_name} required className="input-field" />
        </div>
        <button type="submit" className="btn-primary">{t('common.saveChanges')}</button>
      </form>
    </div>
  );
}
