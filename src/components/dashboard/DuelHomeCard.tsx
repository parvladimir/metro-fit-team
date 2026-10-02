import Link from 'next/link';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { DuelCard } from '@/components/duels/DuelCard';
import { firstName } from '@/lib/event-social';
import { formatDayKeyShort } from '@/lib/date';
import { duelDaysLeft, duelOutcome, formatDuelLines, type DuelView } from '@/lib/duels';

/** "Freundschaftsduell" on Home — one compact card for whichever duel matters
 * right now (see `pickHomeDuel`), or nothing at all: a duel is optional, so
 * there is no empty state to nag about. An invitation waiting for an answer
 * shows in full, with exactly the same terms and "what is shared" text as on
 * the duel page, so it can be answered right here with full information. */
export function DuelHomeCard({ duel, now }: { duel: DuelView | null; now: Date }) {
  if (!duel) return null;
  if (duel.phase === 'pending' && duel.role === 'invitee') return <DuelCard duel={duel} now={now} />;

  const me = firstName(duel.me.name);
  const other = firstName(duel.other.name);
  let headline: string;
  let sub: string;
  let percent: number | null = null;
  let tone: 'challenge' | 'success' = 'challenge';

  if (duel.phase === 'pending') {
    headline = `Einladung an ${duel.other.name}`;
    sub = 'Wartet auf Antwort';
  } else if (duel.phase === 'upcoming') {
    headline = `Duell mit ${duel.other.name}`;
    sub = `Startet ${formatDayKeyShort(duel.startsOn)}`;
  } else if (duel.phase === 'active') {
    const lines = formatDuelLines({ myName: me, otherName: other, target: duel.targetDays, myDays: duel.progress?.me ?? 0, otherDays: duel.progress?.other ?? 0 });
    const left = duelDaysLeft(duel.endsOn, now);
    headline = lines.title;
    sub = duel.progress ? `${lines.me} · ${lines.other} · ${left <= 1 ? 'Letzter Tag' : `Noch ${left} Tage`}` : lines.goal;
    if (duel.progress) {
      percent = (duel.progress.me / duel.targetDays) * 100;
      tone = duel.progress.me >= duel.targetDays ? 'success' : 'challenge';
    }
  } else {
    const outcome = duel.progress
      ? duelOutcome({ target: duel.targetDays, me: { name: me, days: duel.progress.me }, other: { name: other, days: duel.progress.other } })
      : null;
    headline = outcome?.headline ?? 'Das Duell ist beendet.';
    sub = `Duell mit ${duel.other.name}`;
    tone = outcome?.kind === 'both' ? 'success' : 'challenge';
  }

  return (
    <Link href="/team/duelle" className={`card card-accent press ${tone === 'success' ? 'accent-success' : 'accent-challenge'}`}>
      <p className="section-title mb-2">Freundschaftsduell</p>
      <p className="text-sm font-bold text-neutral-900">{headline}</p>
      {percent !== null && (
        <div className="mt-2">
          <ProgressBar tone={tone} percent={percent} />
        </div>
      )}
      <p className="mt-1.5 text-xs text-neutral-500">{sub}</p>
    </Link>
  );
}
