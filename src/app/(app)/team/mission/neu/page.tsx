import { redirect } from 'next/navigation';
import { BackLink } from '@/components/ui/BackLink';
import { requireAuthUser, getPrimaryTeamMembership } from '@/lib/data/profile';
import { addDaysToKey, localDayKey } from '@/lib/date';
import { createMissionAction } from '../actions';

export default async function NeueWochenmissionPage() {
  const user = await requireAuthUser();
  const membership = await getPrimaryTeamMembership(user.id);
  if (!membership || membership.role !== 'team_admin') redirect('/team/mission');

  // Berlin calendar dates (see getCurrentTeamMission) — a UTC date here would
  // pre-fill "yesterday" as the start between 00:00 and 02:00 local time.
  const today = localDayKey(new Date());
  const inOneWeek = addDaysToKey(today, 7);

  return (
    <div className="screen-padding flex flex-col gap-5 pb-8">
      <div className="flex items-center gap-3">
        <BackLink href="/team/mission" />
        <h1 className="text-xl font-bold text-neutral-900">Wochenmission erstellen</h1>
      </div>
      <p className="text-xs text-neutral-500">
        Ein gemeinsames Ziel für die ganze Mannschaft — Trainingstage zählen, nicht Punkte. Das Ziel lässt sich nach dem
        Erstellen nicht mehr ändern, nur abbrechen.
      </p>

      <form action={createMissionAction} className="flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="title">Titel</label>
          <input id="title" name="title" required className="input-field" placeholder="Gemeinsam 12 Trainingstage schaffen" />
        </div>

        <div>
          <label className="label" htmlFor="targetDays">Ziel (Trainingstage im Team)</label>
          <input id="targetDays" name="targetDays" type="number" min={1} required className="input-field" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="startsAt">Start</label>
            <input id="startsAt" name="startsAt" type="date" defaultValue={today} required className="input-field" />
          </div>
          <div>
            <label className="label" htmlFor="endsAt">Ende</label>
            <input id="endsAt" name="endsAt" type="date" defaultValue={inOneWeek} required className="input-field" />
          </div>
        </div>

        <button type="submit" className="btn-primary">Mission starten</button>
      </form>
    </div>
  );
}
