'use client';

import { useRef, useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { ReactionPicker } from '@/components/chat/ReactionPicker';
import { ReactionsSheet } from '@/components/chat/ReactionsSheet';
import { emojiFor, labelFor, summarizeReactions, type ReactionKey, type ReactionsByUser } from '@/lib/reactions';

const VISIBLE_CHIP_LIMIT = 4;

/** Reaction chips + "Reagieren" trigger, shared by every message type (human
 * text/image, Creator cards, shared templates, workout/system events). A user
 * may hold several of the 20 reactions on the same message at once — every
 * chip and every picker entry is an independent toggle for that one emoji,
 * never a single "pick one, it replaces the last" selection. Lives outside
 * `MessageActions` on purpose: that menu is owner-only and doesn't exist at
 * all on system-event cards, while every message needs this regardless of
 * who sent it. All controls are buttons, never `next/link` — nothing here
 * navigates, they only flip local sheet-open state. */
export function ReactionChips({
  messageId,
  currentUserId,
  state,
  onChange,
  className = '',
}: {
  messageId: string;
  currentUserId: string;
  state: ReactionsByUser | undefined;
  onChange: (messageId: string, key: ReactionKey, active: boolean) => void;
  className?: string;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [expandedChips, setExpandedChips] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const reactions = state ?? {};
  const mine = reactions[currentUserId] ?? [];
  const counts = summarizeReactions(reactions);
  const total = counts.reduce((sum, c) => sum + c.count, 0);
  const visible = expandedChips ? counts : counts.slice(0, VISIBLE_CHIP_LIMIT);
  const hiddenCount = counts.length - visible.length;

  function closePicker() {
    setPickerOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {visible.map((c) => {
        const active = mine.includes(c.key);
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onChange(messageId, c.key, !active)}
            aria-pressed={active}
            aria-label={`${labelFor(c.key)}: ${c.count}`}
            className={`inline-flex min-h-[28px] items-center gap-1 rounded-full border px-2 text-xs font-semibold transition active:scale-95 ${
              active ? 'border-brand/40 bg-brand/15 text-brand' : 'border-white/[0.08] bg-surface-3 text-neutral-600'
            }`}
          >
            <span aria-hidden>{emojiFor(c.key)}</span>
            <span className="tabular-nums">{c.count}</span>
          </button>
        );
      })}
      {hiddenCount > 0 && (
        <button type="button" onClick={() => setExpandedChips(true)} className="text-xs font-semibold text-neutral-500 active:text-neutral-400">
          Weitere Reaktionen
        </button>
      )}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setPickerOpen(true)}
        aria-label="Reagieren"
        title="Reagieren"
        className="inline-flex min-h-[28px] items-center gap-1 rounded-full border border-white/[0.08] bg-surface-3 px-2 text-xs font-semibold text-neutral-600 transition active:scale-95"
      >
        <SmilePlus size={14} strokeWidth={2.25} />
      </button>
      {total > 0 && (
        <button type="button" onClick={() => setViewOpen(true)} className="text-xs font-semibold text-neutral-500 underline-offset-2 active:underline">
          Reaktionen ansehen
        </button>
      )}

      {pickerOpen && (
        <ReactionPicker active={mine} onToggle={(key, next) => onChange(messageId, key, next)} onClose={closePicker} />
      )}
      {viewOpen && <ReactionsSheet messageId={messageId} currentUserId={currentUserId} onClose={() => setViewOpen(false)} />}
    </div>
  );
}
