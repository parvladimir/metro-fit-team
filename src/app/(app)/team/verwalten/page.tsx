import Link from 'next/link';
import { requireTeamAdminMembership } from '@/lib/data/admin';
import { t } from '@/lib/i18n';

const LINKS = [
  { href: '/team/verwalten/mitglieder', labelKey: 'admin.members', icon: '👥' },
  { href: '/team/verwalten/einladungen', labelKey: 'admin.invitations', icon: '🔗' },
  { href: '/team/herausforderungen', labelKey: 'admin.challenges', icon: '🏆' },
  { href: '/team/verwalten/ranglistenregeln', labelKey: 'admin.rankingRules', icon: '⚖️' },
  { href: '/team/verwalten/einstellungen', labelKey: 'admin.teamSettings', icon: '🏷️' },
  { href: '/team/verwalten/aktivitaeten', labelKey: 'admin.activity', icon: '📜' },
] as const;

export default async function TeamVerwaltenPage() {
  const membership = await requireTeamAdminMembership();

  return (
    <div className="screen-padding flex flex-col gap-4 pb-4">
      <div className="flex items-center gap-3">
        <Link href="/team" className="text-2xl text-neutral-400">‹</Link>
        <div>
          <h1 className="text-xl font-bold text-neutral-900">{t('admin.title')}</h1>
          <p className="text-xs text-neutral-500">{membership.team_name}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="card flex items-center gap-3 py-4">
            <span className="text-xl">{link.icon}</span>
            <span className="flex-1 text-sm font-semibold text-neutral-900">{t(link.labelKey)}</span>
            <span className="text-neutral-300">›</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
