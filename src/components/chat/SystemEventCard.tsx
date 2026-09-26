import { CheckCircle2, Dumbbell, Play, Target, Trophy } from 'lucide-react';
import { formatSystemEvent, formatSystemEventDuration } from '@/lib/chat-events';
import { formatChatDayLabel } from '@/lib/date';
import type { ChatMessage } from '@/lib/data/chat';

const EVENT_ICONS = {
  workout_started: Play,
  workout_completed: CheckCircle2,
  weekly_goal_reached: Target,
  challenge_completed: Trophy,
} as const;

function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/** Compact pill for an automatic team-activity event (workout start/finish,
 * weekly goal, challenge). Line 1: what happened. Line 2: when it was posted
 * and, for a completed workout, its duration. A third small line shows when
 * the workout actually began — distinct from the post time, read from the
 * event's own metadata rather than a live lookup, so a page of chat history
 * never costs one query per message. */
export function SystemEventCard({ message, isFirstUnread, label }: { message: ChatMessage; isFirstUnread: boolean; label: string }) {
  const Icon = EVENT_ICONS[message.event_type as keyof typeof EVENT_ICONS] ?? Dumbbell;
  const metadata = message.metadata ?? {};
  const duration = message.event_type === 'workout_completed' ? formatSystemEventDuration(metadata) : null;
  const startedAt = typeof metadata.started_at === 'string' ? metadata.started_at : null;

  return (
    <>
      {isFirstUnread && (
        <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-brand">
          <span className="h-px flex-1 bg-brand/25" />
          {label}
          <span className="h-px flex-1 bg-brand/25" />
        </div>
      )}
      <div className="mx-auto flex max-w-[88%] flex-col items-center gap-1 rounded-2xl border border-brand/25 bg-gradient-to-b from-brand/[0.12] to-brand/[0.04] px-3.5 py-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
        <div className="flex items-center gap-2 text-xs text-neutral-600">
          <Icon size={14} strokeWidth={2} className="shrink-0 text-brand" aria-hidden />
          <span className="min-w-0 break-words">{formatSystemEvent(message.authorName, message.event_type, metadata)}</span>
        </div>
        <p className="text-[10px] text-neutral-400">
          {formatChatDayLabel(new Date(message.created_at))} · {timeOfDay(message.created_at)} Uhr
          {duration && <> · {duration}</>}
        </p>
        {startedAt && <p className="text-[10px] text-neutral-400">Beginn: {timeOfDay(startedAt)} Uhr</p>}
      </div>
    </>
  );
}
