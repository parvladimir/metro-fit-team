import { Users } from 'lucide-react';
import { BackLink } from '@/components/ui/BackLink';
import { EmptyState } from '@/components/ui/EmptyState';
import { requireAuthUser, getPrimaryTeamMembership } from '@/lib/data/profile';
import { getDuelsForViewer, getInvitableTeammates } from '@/lib/data/duels';
import { DuelCard } from '@/components/duels/DuelCard';
import { DuelHistoryRow } from '@/components/duels/DuelHistoryRow';
import { DuelProposalForm } from '@/components/duels/DuelProposalForm';
import { DUEL_DEFAULT_START_LEAD_DAYS, DUEL_MAX_START_LEAD_DAYS, DUEL_RESULT_VISIBLE_DAYS } from '@/lib/duels';
import { addDaysToKey, localDayKey } from '@/lib/date';

export default async function FreundschaftsduellPage({ searchParams }: { searchParams: Promise<{ mit?: string }> }) {
  const { mit } = await searchParams;
  const user = await requireAuthUser();
  const membership = await getPrimaryTeamMembership(user.id);

  if (!membership) {
    return (
      <div className="screen-padding pb-4">
        <EmptyState title="Du bist noch in keinem Team." icon={Users} accent="team" />
      </div>
    );
  }

  const now = new Date();
  const today = localDayKey(now);
  const duels = await getDuelsForViewer(user.id, now);

  // Normally at most one duel is open per person. Every open one is shown anyway:
  // if a participant was removed from the team and later rejoined, an older duel
  // becomes visible again next to a newer one, and neither may be hidden from the
  // person who is in both — they must be able to see and end each.
  const isOpen = (d: (typeof duels)[number]) => d.phase === 'pending' || d.phase === 'upcoming' || d.phase === 'active';
  const openDuels = duels.filter(isOpen);
  const justFinished = duels.find((d) => d.phase === 'finished' && today <= addDaysToKey(d.endsOn, DUEL_RESULT_VISIBLE_DAYS)) ?? null;
  const history = duels.filter((d) => !isOpen(d) && d !== justFinished).slice(0, 10);

  const teammates = openDuels.length > 0 ? [] : await getInvitableTeammates(membership.team_id, user.id);
  const preselected = teammates.some((p) => p.id === mit) ? mit : undefined;

  return (
    <div className="screen-padding flex flex-col gap-4 pb-4">
      <div className="flex items-center gap-3">
        <BackLink href="/team" />
        <h1 className="text-xl font-bold text-neutral-900">Freundschaftsduell</h1>
      </div>
      <p className="text-xs text-neutral-500">
        Ein freiwilliges Duell zu zweit: 7 Tage, ein Ziel an Trainingstagen. Kein Ranking, keine Punkte — nur ihr beide seht euren Fortschritt.
      </p>

      {openDuels.map((d) => (
        <DuelCard key={d.id} duel={d} now={now} />
      ))}
      {justFinished && <DuelCard duel={justFinished} now={now} />}

      {openDuels.length === 0 && (
        <section id="neu" className="flex flex-col gap-2">
          <p className="section-title">Neues Duell vorschlagen</p>
          <DuelProposalForm
            teammates={teammates}
            defaultInviteeId={preselected}
            defaultStart={addDaysToKey(today, DUEL_DEFAULT_START_LEAD_DAYS)}
            minStart={addDaysToKey(today, 1)}
            maxStart={addDaysToKey(today, DUEL_MAX_START_LEAD_DAYS)}
          />
        </section>
      )}

      {history.length > 0 && (
        <section>
          <p className="section-title mb-1">Verlauf</p>
          <ul className="divide-y divide-white/[0.06]">
            {history.map((d) => (
              <DuelHistoryRow key={d.id} duel={d} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
