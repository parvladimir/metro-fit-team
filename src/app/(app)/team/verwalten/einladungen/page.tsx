import Link from 'next/link';
import { requireTeamAdminMembership } from '@/lib/data/admin';
import { getTeamInvites, isInviteActive } from '@/lib/data/invites';
import { revokeInviteAction } from './actions';
import { CreateInviteForm } from '@/components/admin/CreateInviteForm';
import { formatGermanDate } from '@/lib/date';
import { t } from '@/lib/i18n';

export default async function EinladungenPage() {
  const admin = await requireTeamAdminMembership();
  const invites = await getTeamInvites(admin.team_id);

  return (
    <div className="screen-padding flex flex-col gap-4 pb-4">
      <div className="flex items-center gap-3">
        <Link href="/team/verwalten" className="text-2xl text-neutral-400">‹</Link>
        <h1 className="text-xl font-bold text-neutral-900">{t('invite.title')}</h1>
      </div>

      <CreateInviteForm />

      <div className="flex flex-col gap-2.5">
        {invites.map((invite) => {
          const active = isInviteActive(invite);
          return (
            <div key={invite.id} className="card flex items-center justify-between py-3.5">
              <div>
                <p className="text-sm font-semibold text-neutral-900">
                  {invite.revoked_at ? t('invite.revoked') : active ? t('invite.active') : t('invite.expired')}
                </p>
                <p className="text-xs text-neutral-500">{t('invite.createdAt', { date: formatGermanDate(invite.created_at) })}</p>
                <p className="text-xs text-neutral-500">
                  {invite.max_uses ? t('invite.uses', { used: invite.use_count, max: invite.max_uses }) : t('invite.usesUnlimited', { used: invite.use_count })}
                </p>
              </div>
              {active && (
                <form action={revokeInviteAction.bind(null, invite.id)}>
                  <button type="submit" className="btn-ghost px-3 py-2 text-xs text-red-600">{t('invite.revoke')}</button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
