import Link from 'next/link';
import { Users, Link2, Trophy, Scale, Tag, ScrollText, ChevronRight } from 'lucide-react';
import { BackLink } from '@/components/ui/BackLink';
import { requireTeamAdminMembership } from '@/lib/data/admin';
import { t } from '@/lib/i18n';

const LINKS = [
  { href: '/team/verwalten/mitglieder', labelKey: 'admin.members', icon: Users },
  { href: '/team/verwalten/einladungen', labelKey: 'admin.invitations', icon: Link2 },
  { href: '/team/herausforderungen', labelKey: 'admin.challenges', icon: Trophy },
  { href: '/team/verwalten/ranglistenregeln', labelKey: 'admin.rankingRules', icon: Scale },
  { href: '/team/verwalten/einstellungen', labelKey: 'admin.teamSettings', icon: Tag },
  { href: '/team/verwalten/aktivitaeten', labelKey: 'admin.activity', icon: ScrollText },
] as const;

export default async function TeamVerwaltenPage() {
  const membership = await requireTeamAdminMembership();

  return (
    <div className="screen-padding flex flex-col gap-4 pb-4">
      <div className="flex items-center gap-3">
        <BackLink href="/team" />
        <div>
          <h1 className="text-xl font-bold text-neutral-900">{t('admin.title')}</h1>
          <p className="text-xs text-neutral-500">{membership.team_name}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        {LINKS.map(({ href, labelKey, icon: Icon }) => (
          <Link key={href} href={href} className="card flex items-center gap-3 py-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-150 text-neutral-500">
              <Icon size={18} strokeWidth={1.9} />
            </span>
            <span className="flex-1 text-sm font-semibold text-neutral-900">{t(labelKey)}</span>
            <ChevronRight size={18} className="shrink-0 text-neutral-300" />
          </Link>
        ))}
      </div>
    </div>
  );
}
