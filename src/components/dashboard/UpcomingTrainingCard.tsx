'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users } from 'lucide-react';
import { RsvpButtons } from '@/components/training/RsvpButtons';
import { setRsvpAction } from '@/app/(app)/team/training/actions';
import { eventDeepLink, firstName } from '@/lib/event-social';
import {
  applyOwnRsvp,
  countsLabel,
  formatInviteWhen,
  inviteCounts,
  inviteState,
  type RsvpStatus,
  type TrainingInviteForViewer,
} from '@/lib/training-invites';

/** "Wer ist dabei?" on Home — the next open joint training (within three
 * days), with the answer buttons right here. Renders nothing when there is none
 * or once it has started, so it never occupies space for an empty state. An
 * answer is a quiet, non-binding signal: no workout, no points, nobody is
 * notified. */
export function UpcomingTrainingCard({ invite: initial }: { invite: TrainingInviteForViewer | null }) {
  const [invite, setInvite] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (!invite || inviteState(invite, now) !== 'upcoming') return null;

  async function answer(next: RsvpStatus | null) {
    if (!invite) return;
    const before = invite;
    setError(null);
    setInvite(applyOwnRsvp(invite, next));
    let ok = false;
    let message = 'Das hat nicht geklappt. Bitte versuche es noch einmal.';
    try {
      const res = await setRsvpAction(before.id, next);
      ok = res.ok;
      if (!res.ok) message = res.error;
    } catch {
      ok = false;
    }
    if (!ok) {
      setInvite((cur) => (cur && cur.myStatus === next ? applyOwnRsvp(cur, before.myStatus) : cur));
      setError(message);
    }
  }

  const where = invite.place ? ` · ${invite.place}` : '';
  return (
    <section className="card card-accent accent-team flex flex-col gap-3" aria-label="Nächstes gemeinsames Training">
      <div className="flex items-center gap-2">
        <Users size={16} strokeWidth={2} className="text-accent-info" aria-hidden />
        <p className="section-title">Wer ist dabei?</p>
      </div>
      <Link href={eventDeepLink(invite.messageId)} className="press min-w-0">
        <p className="break-words text-sm font-bold text-neutral-900">{invite.title}</p>
        <p className="mt-0.5 break-words text-xs text-neutral-500">
          {formatInviteWhen(invite.startsAt, now)}
          {where} · von {firstName(invite.organizerName)}
        </p>
      </Link>
      <p className="text-xs font-semibold text-neutral-800" aria-live="polite">
        {countsLabel(inviteCounts(invite))}
      </p>
      <RsvpButtons status={invite.myStatus} onChange={answer} />
      {error && (
        <p className="text-xs font-medium text-red-400" role="status">
          {error}
        </p>
      )}
    </section>
  );
}
