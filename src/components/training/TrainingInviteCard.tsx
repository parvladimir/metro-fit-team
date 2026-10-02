'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { CalendarClock, Dumbbell, MapPin, Users } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { RsvpButtons } from '@/components/training/RsvpButtons';
import {
  countsLabel,
  formatInviteWhen,
  inviteCounts,
  inviteParticipants,
  inviteState,
  type RsvpStatus,
  type TrainingInviteForViewer,
} from '@/lib/training-invites';
import { t } from '@/lib/i18n';

/** Re-renders once a minute while the training is still ahead, so "bereits
 * gestartet" appears on a card that has been open on screen. */
function useNow(active: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** The chat card for one joint-training invitation. Everything about it is
 * non-binding: answering is a quiet signal, nothing here is a workout, and the
 * place is just text. The viewer's own answer is passed in and out by the
 * parent so a live refresh never fights an optimistic tap. */
export function TrainingInviteCard({
  invite,
  currentUserId,
  onRsvp,
  onCancel,
}: {
  invite: TrainingInviteForViewer;
  currentUserId: string;
  onRsvp: (invite: TrainingInviteForViewer, status: RsvpStatus | null) => void;
  onCancel: (invite: TrainingInviteForViewer) => void;
}) {
  const initialState = inviteState(invite);
  const now = useNow(initialState === 'upcoming');
  const state = inviteState(invite, now);
  const isOrganizer = invite.organizerId === currentUserId;
  const counts = inviteCounts(invite);
  const participants = inviteParticipants(invite);
  const open = state === 'upcoming';
  const shareLink = invite.planShare && !invite.planShare.withdrawnAt ? invite.planShare : null;

  return (
    <section
      aria-label={`Gemeinsames Training: ${invite.title}`}
      // 4.5rem = the chat list's side padding (2 × 1rem) plus the author avatar and its gap, so the card never overflows a 320px screen.
      className={clsx('card card-accent accent-team flex w-[min(calc(100vw-4.5rem),380px)] min-w-0 flex-col gap-3', !open && 'opacity-80')}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Users size={16} strokeWidth={2} className="shrink-0 text-accent-info" aria-hidden />
          <p className="section-title">Wer ist dabei?</p>
        </div>
        {state === 'cancelled' && <span className="rounded-full bg-red-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-red-400">Abgesagt</span>}
        {state === 'started' && <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] font-semibold text-neutral-500">Bereits gestartet</span>}
        {open && invite.editedAt && <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] font-semibold text-neutral-500">Aktualisiert</span>}
      </div>

      <div className="min-w-0">
        <p className={clsx('break-words text-base font-bold text-neutral-900', state === 'cancelled' && 'line-through decoration-neutral-500')}>{invite.title}</p>
        <ul className="mt-1.5 flex flex-col gap-1 text-sm text-neutral-700">
          <li className="flex items-start gap-2">
            <CalendarClock size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-neutral-500" aria-hidden />
            <span className="min-w-0 break-words font-semibold">{formatInviteWhen(invite.startsAt, now)}</span>
          </li>
          {invite.activityType && (
            <li className="flex items-start gap-2">
              <Dumbbell size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-neutral-500" aria-hidden />
              <span className="min-w-0 break-words">{t(`activityType.${invite.activityType}` as Parameters<typeof t>[0])}</span>
            </li>
          )}
          {invite.place && (
            <li className="flex items-start gap-2">
              <MapPin size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-neutral-500" aria-hidden />
              <span className="min-w-0 break-words">{invite.place}</span>
            </li>
          )}
        </ul>
        {invite.note && <p className="mt-2 break-words text-sm text-neutral-600">{invite.note}</p>}
        {shareLink && (
          <p className="mt-2 text-xs text-neutral-500">
            Vorlage:{' '}
            <Link href={`/team/geteilte-vorlagen?q=${encodeURIComponent(shareLink.title)}`} className="font-semibold text-brand underline-offset-2 hover:underline">
              {shareLink.title}
            </Link>
          </p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <Avatar src={invite.organizerAvatar} name={invite.organizerName} size="sm" className="!h-6 !w-6 !text-[10px]" />
          <span className="min-w-0 truncate text-xs text-neutral-500">Organisiert von {isOrganizer ? 'dir' : invite.organizerName}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-3">
        <p className="text-sm font-semibold text-neutral-900" aria-live="polite">
          {countsLabel(counts)}
        </p>
        {open && <RsvpButtons status={invite.myStatus} onChange={(next) => onRsvp(invite, next)} />}
        {state === 'cancelled' && <p className="text-xs text-neutral-500">Diese Einladung wurde abgesagt.</p>}
        {participants.length > 0 && (
          <details className="group text-sm">
            <summary className="cursor-pointer list-none text-xs font-semibold text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
              Wer hat geantwortet? ({participants.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-1.5">
              {participants.map((p) => (
                <li key={p.isMe ? 'me' : p.userId} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    {!p.isMe && <Avatar src={p.avatarUrl} name={p.name} size="sm" className="!h-6 !w-6 !text-[10px]" />}
                    <span className="min-w-0 truncate text-neutral-800">{p.name}</span>
                  </span>
                  <span className="shrink-0 text-xs text-neutral-500">{p.status === 'going' ? 'dabei' : 'vielleicht'}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="text-[11px] text-neutral-400">Zusagen sind unverbindlich und zählen weder als Training noch für Punkte.</p>
      </div>

      {isOrganizer && open && (
        <div className="grid grid-cols-2 gap-2">
          <Link href={`/team/training/${invite.id}/bearbeiten`} className="btn-ghost bg-neutral-100 text-sm">
            Bearbeiten
          </Link>
          <button
            type="button"
            className="btn-ghost bg-neutral-100 text-sm"
            onClick={() => {
              if (window.confirm('Dieses Training wirklich absagen?')) onCancel(invite);
            }}
          >
            Absagen
          </button>
        </div>
      )}
    </section>
  );
}
