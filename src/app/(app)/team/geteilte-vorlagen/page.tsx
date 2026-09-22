import { BackLink } from '@/components/ui/BackLink';
import { Layers } from 'lucide-react';
import { requireAuthUser, getPrimaryTeamMembership } from '@/lib/data/profile';
import { getTeamShares } from '@/lib/data/plan-shares';
import { SharedTemplateRow } from '@/components/sharing/SharedTemplateRow';
import { EXERCISE_TYPE_OPTIONS } from '@/lib/exercise-types';
import { EmptyState } from '@/components/ui/EmptyState';
import { t } from '@/lib/i18n';

export default async function GeteilteVorlagenPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const { q, type } = await searchParams;
  const user = await requireAuthUser();
  const membership = await getPrimaryTeamMembership(user.id);

  if (!membership) {
    return (
      <div className="screen-padding pb-4">
        <EmptyState title={t('team.noTeam.title')} icon={Layers} />
      </div>
    );
  }

  const shares = await getTeamShares(membership.team_id, user.id, { search: q, exerciseType: type });

  return (
    <div className="screen-padding flex flex-col gap-4 pb-8">
      <div className="flex items-center gap-3">
        <BackLink href="/team" />
        <h1 className="text-xl font-bold text-neutral-900">Geteilte Vorlagen</h1>
      </div>

      <form className="flex flex-col gap-2" action="/team/geteilte-vorlagen">
        <div className="flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Nach Titel suchen…"
            className="input-field min-w-0 flex-1"
          />
          <button type="submit" className="btn-secondary shrink-0 px-4 text-sm">Suchen</button>
        </div>
        <select name="type" defaultValue={type ?? ''} className="input-field w-full">
          <option value="">Alle Typen</option>
          {EXERCISE_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </form>

      {shares.length === 0 ? (
        <div className="card-quiet flex items-center gap-3 py-4">
          <span className="icon-chip accent-primary h-10 w-10">
            <Layers size={18} strokeWidth={2} />
          </span>
          <p className="text-sm text-neutral-500">
            {q || type ? 'Keine geteilten Vorlagen gefunden.' : 'Noch niemand hat eine Vorlage im Team-Chat geteilt.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {shares.map((share) => (
            <SharedTemplateRow key={share.id} share={share} />
          ))}
        </div>
      )}
    </div>
  );
}
