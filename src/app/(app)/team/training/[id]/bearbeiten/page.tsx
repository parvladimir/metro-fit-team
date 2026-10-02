import { redirect } from 'next/navigation';
import { BackLink } from '@/components/ui/BackLink';
import { TrainingInviteForm } from '@/components/training/TrainingInviteForm';
import { requireAuthUser } from '@/lib/data/profile';
import { getInviteForEdit, getTeamShareOptions } from '@/lib/data/training-invites';
import { toLocalDateTimeInputValue } from '@/lib/date';

export default async function TrainingBearbeitenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAuthUser();
  // Organizer only, and only while the invitation is still open — anything
  // else (someone else's, cancelled, gone) just goes back to the chat.
  const invite = await getInviteForEdit(id, user.id);
  if (!invite || new Date(invite.startsAt).getTime() <= Date.now()) redirect('/team/chat');

  const shares = await getTeamShareOptions(invite.teamId);

  return (
    <div className="screen-padding flex flex-col gap-4 pb-6">
      <div className="flex items-center gap-3">
        <BackLink href="/team/chat" />
        <h1 className="text-xl font-bold text-neutral-900">Training bearbeiten</h1>
      </div>
      <p className="text-xs text-neutral-500">
        Wer schon geantwortet hat, bleibt dabei. Ändert sich Zeit oder Ort, bekommen alle, die geantwortet haben, einmal Bescheid (sofern sie Benachrichtigungen dafür aktiviert haben).
      </p>
      <TrainingInviteForm
        mode="edit"
        inviteId={invite.id}
        shares={shares}
        minStartsAt={toLocalDateTimeInputValue(new Date())}
        initial={{
          title: invite.title,
          startsAt: toLocalDateTimeInputValue(new Date(invite.startsAt)),
          activityType: invite.activityType ?? '',
          planShareId: invite.planShare?.id ?? '',
          place: invite.place ?? '',
          note: invite.note ?? '',
        }}
      />
    </div>
  );
}
