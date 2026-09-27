'use client';

import { useEffect, useState } from 'react';
import { getMessageReactorsAction, type Reactor } from '@/app/(app)/team/chat/actions';
import { Avatar } from '@/components/ui/Avatar';
import { emojiFor, labelFor, type ReactionKey } from '@/lib/reactions';

/** "Reaktionen ansehen": who reacted, and with what. Fetched on demand (not
 * preloaded per message). Header + tabs are `shrink-0`, only the reactor list
 * scrolls (`overflow-y-auto` inside a bounded `max-h`) — a normal flex/scroll
 * layout, not `position: sticky`, so it can't conflict with any ancestor's
 * sticky positioning (the app shell's bottom nav is `sticky`). */
export function ReactionsSheet({
  messageId,
  currentUserId,
  onClose,
}: {
  messageId: string;
  currentUserId: string;
  onClose: () => void;
}) {
  const [reactors, setReactors] = useState<Reactor[] | null>(null);
  const [tab, setTab] = useState<ReactionKey | 'all'>('all');

  useEffect(() => {
    let cancelled = false;
    getMessageReactorsAction(messageId).then((r) => {
      if (!cancelled) setReactors(r);
    });
    return () => {
      cancelled = true;
    };
  }, [messageId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const tabs: (ReactionKey | 'all')[] = ['all', ...Array.from(new Set((reactors ?? []).map((r) => r.reactionKey)))];
  const shown = (reactors ?? []).filter((r) => tab === 'all' || r.reactionKey === tab);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose} role="dialog" aria-modal="true" aria-label="Reaktionen ansehen">
      <div
        className="mx-auto flex max-h-[70vh] w-full max-w-app flex-col rounded-t-3xl border-t border-white/10 bg-neutral-100 p-4"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-neutral-300" />
        <h2 className="mb-2 shrink-0 text-sm font-bold text-neutral-900">Reaktionen</h2>
        <div className="mb-3 flex shrink-0 gap-1.5 overflow-x-auto">
          {tabs.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              aria-pressed={tab === k}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                tab === k ? 'bg-brand/15 text-brand ring-1 ring-brand/40' : 'bg-surface-3 text-neutral-600'
              }`}
            >
              {k === 'all' ? 'Alle' : emojiFor(k)}
            </button>
          ))}
        </div>
        <div className="flex min-h-0 flex-col gap-1 overflow-y-auto">
          {reactors === null && <p className="py-4 text-center text-sm text-neutral-500">Lädt…</p>}
          {reactors !== null && shown.length === 0 && <p className="py-4 text-center text-sm text-neutral-500">Keine Reaktionen.</p>}
          {shown.map((r) => (
            <div key={r.userId} className="flex items-center gap-2.5 rounded-xl px-2 py-2">
              <Avatar src={r.avatarUrl} name={r.name} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-900">{r.userId === currentUserId ? 'Du' : r.name}</span>
              <span className="text-lg" role="img" aria-label={labelFor(r.reactionKey)}>
                {emojiFor(r.reactionKey)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
