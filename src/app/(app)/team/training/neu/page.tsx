import { Users } from 'lucide-react';
import { BackLink } from '@/components/ui/BackLink';
import { EmptyState } from '@/components/ui/EmptyState';
import { TrainingInviteForm } from '@/components/training/TrainingInviteForm';
import { requireAuthUser, getPrimaryTeamMembership } from '@/lib/data/profile';
import { getTeamShareOptions } from '@/lib/data/training-invites';
import { addDaysToKey, localDayKey, toLocalDateTimeInputValue } from '@/lib/date';

export default async function NeuesGemeinsamesTrainingPage() {
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
  const shares = await getTeamShareOptions(membership.team_id);

  return (
    <div className="screen-padding flex flex-col gap-4 pb-6">
      <div className="flex items-center gap-3">
        <BackLink href="/team/chat" />
        <h1 className="text-xl font-bold text-neutral-900">Wer ist dabei?</h1>
      </div>
      <p className="text-xs text-neutral-500">
        Schlage dem Team ein gemeinsames Training vor. Die Einladung erscheint als eine Karte im Team-Chat; alle können mit „Dabei“ oder „Vielleicht“ antworten.
      </p>
      {/* Fresh idempotency key per page render: a double tap or a retry after a flaky network can only ever make one card. */}
      <TrainingInviteForm
        mode="create"
        inviteId={crypto.randomUUID()}
        shares={shares}
        minStartsAt={toLocalDateTimeInputValue(now)}
        initial={{ title: '', startsAt: `${addDaysToKey(localDayKey(now), 1)}T18:00`, activityType: '', planShareId: '', place: '', note: '' }}
      />
    </div>
  );
}
