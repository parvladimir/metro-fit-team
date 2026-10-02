import { DUEL_LENGTH_DAYS, formatDuelRange, trainingDaysLabel } from '@/lib/duels';

/** What is shared in a duel, in plain words. Shown on the proposal form and
 * again — identically for both people — on the invitation they receive, so
 * nobody agrees to something they could not read first. */
export function DuelSharingNotes() {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-neutral-500">
      <li>Ihr beide seht nur eure Anzahl Trainingstage in diesem Zeitraum – keine Inhalte.</li>
      <li>Das zählt auch, wenn du Aktivitäten sonst nicht im Team teilst.</li>
      <li>Kein Punkte-Effekt, kein Ranking. Ergebnisse bleiben privat.</li>
      <li>Du kannst jederzeit ohne Begründung beenden.</li>
    </ul>
  );
}

/** The terms of one concrete duel plus {@link DuelSharingNotes}. */
export function DuelRules({ targetDays, startsOn, endsOn }: { targetDays: number; startsOn: string; endsOn: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/[0.06] bg-surface-1 px-3 py-3">
      <p className="text-sm font-semibold text-neutral-900">Ziel: {trainingDaysLabel(targetDays)}</p>
      <p className="text-xs text-neutral-600">
        Zeitraum: {formatDuelRange(startsOn, endsOn)} ({DUEL_LENGTH_DAYS} Tage)
      </p>
      <DuelSharingNotes />
    </div>
  );
}
