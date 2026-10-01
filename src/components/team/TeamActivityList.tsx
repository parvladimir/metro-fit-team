'use client';

import { ActivityMemberRow } from '@/components/team/ActivityMemberRow';
import { useTeamReactions } from '@/lib/use-team-reactions';
import type { ReactionsByUser } from '@/lib/reactions';
import type { TeamActivitySummary } from '@/lib/data/team-activity';

/** The fuller `/team/aktivitaet` view's row list — same `ActivityMemberRow`
 * as the Home card, uncapped, sharing the same reaction-state hook so a
 * reaction made here behaves identically to one made from Home or chat. */
export function TeamActivityList({
  summary,
  initialReactions,
  currentUserId,
}: {
  summary: TeamActivitySummary;
  initialReactions: Record<string, ReactionsByUser>;
  currentUserId: string;
}) {
  const { reactions, onReactionChange } = useTeamReactions(initialReactions, currentUserId);

  if (summary.activeMemberCount === 0) {
    return <p className="py-6 text-center text-sm text-neutral-500">Noch keine geteilten Trainings in diesem Zeitraum.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {summary.members.map((m) => (
        <ActivityMemberRow key={m.userId} member={m} currentUserId={currentUserId} reactions={reactions} onReactionChange={onReactionChange} />
      ))}
    </div>
  );
}
