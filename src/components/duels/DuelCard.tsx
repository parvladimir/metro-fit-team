import { Swords } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { ConfirmSubmitButton } from '@/components/ui/ConfirmSubmitButton';
import { cancelDuelAction, respondDuelAction } from '@/app/(app)/team/duelle/actions';
import { firstName } from '@/lib/event-social';
import { formatDayKeyShort } from '@/lib/date';
import {
  duelDaysLeft,
  duelOutcome,
  formatDuelLines,
  formatDuelRange,
  formatReplyDeadline,
  trainingDaysLabel,
  type DuelView,
} from '@/lib/duels';
import { DuelRules } from './DuelRules';

function Header({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Swords size={16} strokeWidth={2} className="text-accent-challenge" aria-hidden />
      <p className="section-title">{children}</p>
    </div>
  );
}

function EndDuelForm({ duelId, label, confirm }: { duelId: string; label: string; confirm: string }) {
  return (
    <form action={cancelDuelAction.bind(null, duelId)}>
      <ConfirmSubmitButton className="btn-ghost w-full bg-neutral-100 text-sm" confirmMessage={confirm}>
        {label}
      </ConfirmSubmitButton>
    </form>
  );
}

/** Both people's capped counts as two labelled bars. */
function ProgressLines({ duel }: { duel: DuelView }) {
  if (!duel.progress) return <p className="text-xs text-neutral-500">Der Stand ist gerade nicht verfügbar.</p>;
  const lines = formatDuelLines({
    myName: firstName(duel.me.name),
    otherName: firstName(duel.other.name),
    target: duel.targetDays,
    myDays: duel.progress.me,
    otherDays: duel.progress.other,
  });
  const rows = [
    { key: 'other', person: duel.other, text: lines.other, days: duel.progress.other },
    { key: 'me', person: duel.me, text: lines.me, days: duel.progress.me },
  ];
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.key}>
          <div className="mb-1 flex items-center gap-2">
            <Avatar src={row.person.avatarUrl} name={row.person.name} size="sm" />
            <span className="text-sm font-medium text-neutral-800">{row.text}</span>
          </div>
          <ProgressBar tone={row.days >= duel.targetDays ? 'success' : 'challenge'} percent={(row.days / duel.targetDays) * 100} />
        </div>
      ))}
    </div>
  );
}

function IncomingInvitation({ duel }: { duel: DuelView }) {
  return (
    <section className="card card-accent accent-challenge flex flex-col gap-3" aria-label="Einladung zum Freundschaftsduell">
      <Header>Einladung zum Duell</Header>
      <div className="flex items-center gap-3">
        <Avatar src={duel.other.avatarUrl} name={duel.other.name} size="md" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-neutral-900">{duel.other.name} lädt dich zu einem Freundschaftsduell ein.</p>
          <p className="text-xs text-neutral-500">Antwort möglich bis {formatReplyDeadline(duel.expiresAt)}</p>
        </div>
      </div>
      <DuelRules targetDays={duel.targetDays} startsOn={duel.startsOn} endsOn={duel.endsOn} />
      <div className="grid grid-cols-2 gap-2">
        <form action={respondDuelAction.bind(null, duel.id, true)}>
          <SubmitButton>Annehmen</SubmitButton>
        </form>
        <form action={respondDuelAction.bind(null, duel.id, false)}>
          <button type="submit" className="btn-secondary w-full">Ablehnen</button>
        </form>
      </div>
      <p className="text-[11px] text-neutral-400">Du kannst ablehnen, ohne etwas zu erklären.</p>
    </section>
  );
}

function OutgoingInvitation({ duel }: { duel: DuelView }) {
  return (
    <section className="card card-accent accent-challenge flex flex-col gap-3" aria-label="Gesendete Duell-Einladung">
      <Header>Einladung gesendet</Header>
      <div className="flex items-center gap-3">
        <Avatar src={duel.other.avatarUrl} name={duel.other.name} size="md" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-neutral-900">Du hast {duel.other.name} zu einem Freundschaftsduell eingeladen.</p>
          <p className="text-xs text-neutral-500">Antwort möglich bis {formatReplyDeadline(duel.expiresAt)}</p>
        </div>
      </div>
      <DuelRules targetDays={duel.targetDays} startsOn={duel.startsOn} endsOn={duel.endsOn} />
      <EndDuelForm duelId={duel.id} label="Einladung zurückziehen" confirm="Einladung zurückziehen?" />
    </section>
  );
}

function UpcomingDuel({ duel }: { duel: DuelView }) {
  const lines = formatDuelLines({
    myName: firstName(duel.me.name),
    otherName: firstName(duel.other.name),
    target: duel.targetDays,
    myDays: 0,
    otherDays: 0,
  });
  return (
    <section className="card card-accent accent-challenge flex flex-col gap-3" aria-label="Bevorstehendes Freundschaftsduell">
      <Header>Duell angenommen</Header>
      <p className="text-base font-bold text-neutral-900">{lines.title}</p>
      <p className="text-sm text-neutral-700">Es startet {formatDayKeyShort(duel.startsOn)}.</p>
      <DuelRules targetDays={duel.targetDays} startsOn={duel.startsOn} endsOn={duel.endsOn} />
      <EndDuelForm duelId={duel.id} label="Duell beenden" confirm="Duell beenden? Du musst nichts erklären." />
    </section>
  );
}

function ActiveDuel({ duel, now }: { duel: DuelView; now: Date }) {
  const left = duelDaysLeft(duel.endsOn, now);
  const title = formatDuelLines({
    myName: firstName(duel.me.name),
    otherName: firstName(duel.other.name),
    target: duel.targetDays,
    myDays: 0,
    otherDays: 0,
  });
  return (
    <section className="card card-accent accent-challenge flex flex-col gap-3" aria-label="Laufendes Freundschaftsduell">
      <Header>Freundschaftsduell</Header>
      <div>
        <p className="text-base font-bold text-neutral-900">{title.title}</p>
        <p className="mt-0.5 text-xs text-neutral-500">
          {title.goal} · {formatDuelRange(duel.startsOn, duel.endsOn)} · {left <= 1 ? 'Letzter Tag' : `Noch ${left} Tage`}
        </p>
      </div>
      <ProgressLines duel={duel} />
      <p className="text-[11px] text-neutral-400">Nur ihr beide seht diesen Stand. Er wird bei jedem Aufruf neu berechnet.</p>
      <EndDuelForm duelId={duel.id} label="Duell beenden" confirm="Duell beenden? Du musst nichts erklären." />
    </section>
  );
}

function FinishedDuel({ duel }: { duel: DuelView }) {
  const outcome = duel.progress
    ? duelOutcome({
        target: duel.targetDays,
        me: { name: firstName(duel.me.name), days: duel.progress.me },
        other: { name: firstName(duel.other.name), days: duel.progress.other },
      })
    : null;
  return (
    <section className={`card card-accent flex flex-col gap-3 ${outcome?.kind === 'both' ? 'accent-success' : 'accent-challenge'}`} aria-label="Beendetes Freundschaftsduell">
      <Header>Duell beendet</Header>
      <p className="text-xs text-neutral-500">
        {duel.me.name} und {duel.other.name} · {trainingDaysLabel(duel.targetDays)} · {formatDuelRange(duel.startsOn, duel.endsOn)}
      </p>
      {outcome ? (
        <div>
          <p className="text-base font-bold text-neutral-900">{outcome.kind === 'both' ? `🎉 ${outcome.headline}` : outcome.headline}</p>
          <p className="mt-1 text-sm text-neutral-600">{outcome.detail}</p>
        </div>
      ) : (
        <p className="text-sm text-neutral-600">Das Duell ist beendet.</p>
      )}
      <ProgressLines duel={duel} />
      <p className="text-[11px] text-neutral-400">Das Ergebnis bleibt privat zwischen euch beiden.</p>
    </section>
  );
}

/** One duel that needs the viewer's attention or shows a running/finished
 * result. Past, never-started duels (declined, expired, cancelled) use
 * {@link DuelHistoryRow} instead. */
export function DuelCard({ duel, now }: { duel: DuelView; now: Date }) {
  switch (duel.phase) {
    case 'pending':
      return duel.role === 'invitee' ? <IncomingInvitation duel={duel} /> : <OutgoingInvitation duel={duel} />;
    case 'upcoming':
      return <UpcomingDuel duel={duel} />;
    case 'active':
      return <ActiveDuel duel={duel} now={now} />;
    case 'finished':
      return <FinishedDuel duel={duel} />;
    default:
      return null;
  }
}
