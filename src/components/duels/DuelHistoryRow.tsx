import Link from 'next/link';
import { firstName } from '@/lib/event-social';
import { duelOutcome, formatDuelRange, type DuelView } from '@/lib/duels';

/** A past duel as one quiet line. An invitation that did not happen is worded
 * the same whether it was declined or simply ran out — "nicht zustande
 * gekommen" — so the person who sent it never reads a rejection into it. */
function describe(duel: DuelView): string {
  const other = duel.other.name;
  switch (duel.phase) {
    case 'finished': {
      if (!duel.progress) return `Duell mit ${other} beendet`;
      return duelOutcome({
        target: duel.targetDays,
        me: { name: firstName(duel.me.name), days: duel.progress.me },
        other: { name: firstName(other), days: duel.progress.other },
      }).headline;
    }
    case 'cancelled':
      return `Duell mit ${other} beendet`;
    default:
      return duel.role === 'inviter' ? `Einladung an ${other} nicht zustande gekommen` : `Einladung von ${other} nicht zustande gekommen`;
  }
}

export function DuelHistoryRow({ duel }: { duel: DuelView }) {
  // Only an invitation of mine that lapsed offers a quick "again".
  const canRetry = duel.role === 'inviter' && (duel.phase === 'expired' || duel.phase === 'declined');
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="break-words text-sm text-neutral-800">{describe(duel)}</p>
        <p className="text-xs text-neutral-500">{formatDuelRange(duel.startsOn, duel.endsOn)}</p>
      </div>
      {canRetry && (
        <Link href={`/team/duelle?mit=${duel.other.id}#neu`} className="btn-ghost shrink-0 bg-neutral-100 text-xs">
          Neu vorschlagen
        </Link>
      )}
    </li>
  );
}
