import { BackLink } from '@/components/ui/BackLink';
import { requireTeamAdminMembership } from '@/lib/data/admin';
import { getTeamEngagementSummary } from '@/lib/data/engagement';
import { addDaysToKey } from '@/lib/date';

const WEEKS = 8;

/** "29.09. – 05.10." for a Berlin week starting on `weekStart` (a Monday). */
function weekLabel(weekStart: string): string {
  const fmt = (key: string) => `${key.slice(8, 10)}.${key.slice(5, 7)}.`;
  return `${fmt(weekStart)} – ${fmt(addDaysToKey(weekStart, 6))}`;
}

export default async function AuswertungPage() {
  const membership = await requireTeamAdminMembership();
  const weeks = await getTeamEngagementSummary(membership.team_id, WEEKS);
  const latest = weeks?.[0];

  return (
    <div className="screen-padding flex flex-col gap-4 pb-6">
      <div className="flex items-center gap-3">
        <BackLink href="/team/verwalten" />
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Auswertung</h1>
          <p className="text-xs text-neutral-500">{membership.team_name} · letzte {WEEKS} Wochen</p>
        </div>
      </div>

      <div className="card-quiet flex flex-col gap-1.5 text-xs text-neutral-600">
        <p>Nur Zahlen — keine Namen, keine Einzelwerte. Wochen laufen von Montag bis Sonntag (Berliner Zeit).</p>
        {latest && (
          <p>
            In den Aktivitätszahlen sind nur Mitglieder enthalten, die ihre Aktivitäten im Team teilen ({latest.countedMembers} von {latest.memberCount}).
          </p>
        )}
      </div>

      {weeks === null ? (
        <p className="text-sm text-neutral-500">Die Auswertung ist gerade nicht verfügbar.</p>
      ) : (
        <div className="-mx-1 overflow-x-auto rounded-2xl border border-white/[0.08]">
          <table className="w-full min-w-[620px] border-collapse text-left text-sm">
            <caption className="sr-only">Wöchentliche Teamzahlen der letzten {WEEKS} Wochen</caption>
            <thead>
              <tr className="border-b border-white/[0.08] text-[11px] uppercase tracking-wide text-neutral-500">
                <th scope="col" className="sticky left-0 z-10 bg-surface-2 px-3 py-2.5 font-semibold">Woche</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Aktiv</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Wieder dabei</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Unterstützt</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Ziel erreicht</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Missionen</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Duelle</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Einladungen</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.weekStart} className="border-b border-white/[0.05] last:border-0">
                  <th scope="row" className="sticky left-0 z-10 bg-surface-2 px-3 py-2.5 text-left font-semibold text-neutral-900">
                    <span className="block whitespace-nowrap tabular-nums">{weekLabel(w.weekStart)}</span>
                    {w.inProgress && <span className="text-[11px] font-medium text-brand">laufend</span>}
                  </th>
                  <td className="px-3 py-2.5 tabular-nums text-neutral-800">
                    {w.activeParticipants}
                    <span className="text-neutral-500"> / {w.countedMembers}</span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-neutral-800">{w.returningParticipants}</td>
                  <td className="px-3 py-2.5 tabular-nums text-neutral-800">{w.supportedWorkouts}</td>
                  <td className="px-3 py-2.5 tabular-nums text-neutral-800">
                    {w.goalReachedMembers}
                    <span className="text-neutral-500"> / {w.countedMembers}</span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-neutral-800">
                    {w.missionsStarted}
                    {w.missionsStarted > 0 && (
                      <span className="block text-[11px] text-neutral-500">
                        {w.missionsReached} erreicht{w.missionsCancelled > 0 ? ` · ${w.missionsCancelled} abgebrochen` : ''}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-neutral-800">
                    {w.duelsAccepted}
                    {w.duelsAccepted > 0 && <span className="block text-[11px] text-neutral-500">{w.duelsFinished} beendet</span>}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-neutral-800">{w.trainingInvitesCreated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ul className="flex list-disc flex-col gap-1.5 pl-4 text-[11px] text-neutral-500">
        <li><strong className="font-semibold text-neutral-600">Aktiv:</strong> Mitglieder mit mindestens einem abgeschlossenen Training in der Woche. <strong className="font-semibold text-neutral-600">Wieder dabei:</strong> davon auch in der Vorwoche aktiv.</li>
        <li><strong className="font-semibold text-neutral-600">Unterstützt:</strong> abgeschlossene Trainings, auf die ein anderes Mitglied reagiert oder geantwortet hat.</li>
        <li><strong className="font-semibold text-neutral-600">Ziel erreicht:</strong> Mitglieder, die ihr eigenes Wochenziel geschafft haben. Missionen und Duelle zählen nach Startwoche; Duell-Ergebnisse und Antworten auf Einladungen sind bewusst nicht enthalten.</li>
        <li>Rohzahlen — keine statistische Aussage darüber, ob sich Fitness oder Motivation verbessern. Echte Mitglieder und Testkonten lassen sich nicht unterscheiden.</li>
        <li>Bei kleinen Teams können einzelne Zahlen auf einzelne Personen hindeuten. Bitte vertraulich behandeln.</li>
      </ul>
    </div>
  );
}
