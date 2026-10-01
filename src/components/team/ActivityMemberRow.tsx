'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { ReactionChips } from '@/components/chat/ReactionChips';
import { eventDeepLink } from '@/lib/event-social';
import { formatDurationWords } from '@/lib/workout-metrics';
import type { ReactionKey, ReactionsByUser } from '@/lib/reactions';
import type { TeamActivityMember, TeamActivityWorkout } from '@/lib/data/team-activity';
import { t } from '@/lib/i18n';

function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function workoutLabel(w: TeamActivityWorkout): string {
  return w.title || t(`activityType.${w.activityType}` as const);
}

/** One member's row in "Heute im Team" / `/team/aktivitaet`. A single workout
 * renders inline; several collapse to "N Trainings" and expand to individual,
 * independently-reactable rows — reactions are keyed per `messageId` and are
 * never merged across a member's different workouts. */
export function ActivityMemberRow({
  member,
  currentUserId,
  reactions,
  onReactionChange,
}: {
  member: TeamActivityMember;
  currentUserId: string;
  reactions: Record<string, ReactionsByUser>;
  onReactionChange: (messageId: string, key: ReactionKey, active: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const single = member.workouts.length === 1 ? member.workouts[0]! : null;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/[0.06] bg-surface-1 px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <Avatar src={member.avatarUrl} name={member.fullName} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-neutral-900">{member.fullName}</p>
          {single ? (
            <Link href={eventDeepLink(single.messageId)} className="block truncate text-xs text-neutral-500">
              {workoutLabel(single)} · abgeschlossen um {timeOfDay(single.finishedAt)}
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 text-xs text-neutral-500"
            >
              {member.workouts.length} Trainings
              <ChevronDown size={13} strokeWidth={2.5} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
        {single?.durationSeconds ? (
          <span className="shrink-0 text-xs font-medium text-neutral-500">{formatDurationWords(single.durationSeconds)}</span>
        ) : null}
      </div>

      {single && (
        <ReactionChips messageId={single.messageId} currentUserId={currentUserId} state={reactions[single.messageId]} onChange={onReactionChange} className="pl-[42px]" />
      )}

      {!single && expanded && (
        <ul className="flex flex-col gap-2 pl-[42px]">
          {member.workouts.map((w) => (
            <li key={w.workoutId} className="flex flex-col gap-1">
              <Link href={eventDeepLink(w.messageId)} className="flex items-center justify-between gap-2 text-xs text-neutral-500">
                <span className="truncate">
                  {workoutLabel(w)} · {timeOfDay(w.finishedAt)}
                </span>
                {w.durationSeconds ? <span className="shrink-0 font-medium">{formatDurationWords(w.durationSeconds)}</span> : null}
              </Link>
              <ReactionChips messageId={w.messageId} currentUserId={currentUserId} state={reactions[w.messageId]} onChange={onReactionChange} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
