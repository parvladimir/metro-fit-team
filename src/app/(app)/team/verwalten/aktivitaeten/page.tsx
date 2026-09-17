import Link from 'next/link';
import { ScrollText } from 'lucide-react';
import { BackLink } from '@/components/ui/BackLink';
import { requireTeamAdminMembership, getAuditLog } from '@/lib/data/admin';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatGermanDate } from '@/lib/date';
import { t } from '@/lib/i18n';

const ACTION_LABELS: Record<string, string> = {
  team_created: 'Team erstellt',
  member_promoted_team_admin: 'Zum Team-Admin ernannt',
  member_demoted_member: 'Admin-Rechte entzogen',
  member_removed: 'Mitglied entfernt',
  member_joined: 'Mitglied beigetreten',
  invite_created: 'Einladung erstellt',
  invite_revoked: 'Einladung widerrufen',
  challenge_created: 'Herausforderung erstellt',
  ranking_rules_updated: 'Ranglistenregeln aktualisiert',
  team_settings_updated: 'Team-Einstellungen aktualisiert',
};

export default async function AktivitaetenPage() {
  const admin = await requireTeamAdminMembership();
  const events = await getAuditLog(admin.team_id);

  return (
    <div className="screen-padding flex flex-col gap-4 pb-4">
      <div className="flex items-center gap-3">
        <BackLink href="/team/verwalten" />
        <h1 className="text-xl font-bold text-neutral-900">{t('admin.auditLog.title')}</h1>
      </div>

      {events.length === 0 ? (
        <EmptyState title="Noch keine Administrationsaktivitäten." icon={ScrollText} />
      ) : (
        <div className="flex flex-col gap-2">
          {events.map((e) => (
            <div key={e.id} className="card flex items-center justify-between py-3">
              <p className="text-sm font-medium text-neutral-800">{ACTION_LABELS[e.action] || e.action}</p>
              <p className="text-xs text-neutral-400">{formatGermanDate(e.created_at)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
