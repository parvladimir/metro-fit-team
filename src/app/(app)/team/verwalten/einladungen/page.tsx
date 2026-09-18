import { BackLink } from '@/components/ui/BackLink';
import { requireTeamAdminMembership } from '@/lib/data/admin';
import { getTeamInvites, getInviteEmails, isInviteActive } from '@/lib/data/invites';
import { revokeInviteAction } from './actions';
import { EmailInviteForm } from '@/components/admin/EmailInviteForm';
import { CreateInviteForm } from '@/components/admin/CreateInviteForm';
import { formatGermanDate } from '@/lib/date';
import { t } from '@/lib/i18n';

export default async function EinladungenPage() {
  const admin = await requireTeamAdminMembership();
  const invites = await getTeamInvites(admin.team_id);
  const mails = await getInviteEmails(admin.team_id);

  return (
    <div className="screen-padding flex flex-col gap-4 pb-4">
      <div className="flex items-center gap-3">
        <BackLink href="/team/verwalten" />
        <h1 className="text-xl font-bold text-neutral-900">{t('invite.title')}</h1>
      </div>

      <CreateInviteForm />
      <EmailInviteForm />

      {mails.length > 0 && (
        <section className="flex flex-col gap-2">
          <p className="section-title">Per E-Mail gesendet</p>
          {mails.map((m) => (
            <div key={m.id} className="card flex items-center justify-between gap-3 py-3">
              <p className="min-w-0 flex-1 truncate text-sm text-neutral-800">{m.email}</p>
              <p className={`shrink-0 text-xs ${m.status === 'sent' ? 'text-neutral-400' : 'text-red-400'}`}>
                {m.status === 'sent' ? formatGermanDate(m.created_at) : 'Fehlgeschlagen'}
              </p>
            </div>
          ))}
        </section>
      )}

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
                  <button type="submit" className="btn-destructive shrink-0 px-3 py-2 text-xs">{t('invite.revoke')}</button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
