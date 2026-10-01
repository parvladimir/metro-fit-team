'use client';

import Link from 'next/link';
import { ActivityMemberRow } from '@/components/team/ActivityMemberRow';
import { useTeamReactions } from '@/lib/use-team-reactions';
import type { ReactionsByUser } from '@/lib/reactions';
import type { TeamActivitySummary } from '@/lib/data/team-activity';

const VISIBLE_ROW_LIMIT = 4;

/** "Heute im Team" — up to 4 rows of today's team activity, each reactable
 * exactly like its counterpart in chat. */
export function TeamActivityCard({
  summary,
  initialReactions,
  currentUserId,
}: {
  summary: TeamActivitySummary;
  initialReactions: Record<string, ReactionsByUser>;
  currentUserId: string;
}) {
  const { reactions, onReactionChange } = useTeamReactions(initialReactions, currentUserId);
  const visible = summary.members.slice(0, VISIBLE_ROW_LIMIT);

  return (
    <section className="card accent-team card-accent">
      <p className="section-title mb-3">Heute im Team</p>

      {summary.activeMemberCount === 0 ? (
        <p className="py-3 text-center text-sm text-neutral-500">Noch keine geteilten Trainings für heute.</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-neutral-600">
            {summary.activeMemberCount === 1 ? '1 Mitglied hat heute trainiert.' : `${summary.activeMemberCount} Mitglieder haben heute trainiert.`}
            {summary.runningCount > 0 &&
              (summary.runningCount === 1 ? ' 1 Training wird gerade aufgezeichnet.' : ` ${summary.runningCount} Trainings werden gerade aufgezeichnet.`)}
          </p>
          <div className="flex flex-col gap-2">
            {visible.map((m) => (
              <ActivityMemberRow key={m.userId} member={m} currentUserId={currentUserId} reactions={reactions} onReactionChange={onReactionChange} />
            ))}
          </div>
          <Link href="/team/aktivitaet" className="mt-3 block text-center text-xs font-semibold text-brand">
            Alle ansehen
          </Link>
        </>
      )}
    </section>
  );
}
