'use client';

import { useEffect, useState } from 'react';
import { getMessageReactorsAction, type Reactor } from '@/app/(app)/team/chat/actions';
import { Avatar } from '@/components/ui/Avatar';
import { emojiFor, labelFor, REACTIONS, type ReactionKey } from '@/lib/reactions';

interface GroupedReactor {
  userId: string;
  name: string;
  avatarUrl: string | null;
  keys: ReactionKey[];
}

const KEY_ORDER = new Map(REACTIONS.map((r, i) => [r.key, i]));

/** One reactor row per person under "Alle" — a person with several active
 * reactions (👍 and 🔥, say) is ONE row showing both emojis, not two separate
 * rows. A per-emoji tab needs no grouping: each user appears at most once for
 * any single emoji already. */
function groupByUser(reactors: Reactor[]): GroupedReactor[] {
  const byUser = new Map<string, GroupedReactor>();
  for (const r of reactors) {
    const existing = byUser.get(r.userId);
    if (existing) existing.keys.push(r.reactionKey);
    else byUser.set(r.userId, { userId: r.userId, name: r.name, avatarUrl: r.avatarUrl, keys: [r.reactionKey] });
  }
  for (const g of byUser.values()) g.keys.sort((a, b) => (KEY_ORDER.get(a) ?? 0) - (KEY_ORDER.get(b) ?? 0));
  return [...byUser.values()];
}

/** "Reaktionen ansehen": who reacted, and with what — a person can appear
 * with several emojis at once. Fetched on demand (not preloaded per
 * message). Header + tabs are `shrink-0`, only the reactor list scrolls
 * (`overflow-y-auto` inside a bounded `max-h`) — a normal flex/scroll layout,
 * not `position: sticky`, so it can't conflict with any ancestor's sticky
 * positioning (the app shell's bottom nav is `sticky`). */
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
  const shown =
    tab === 'all'
      ? groupByUser(reactors ?? [])
      : groupByUser((reactors ?? []).filter((r) => r.reactionKey === tab));

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
          {shown.map((g) => (
            <div key={g.userId} className="flex items-center gap-2.5 rounded-xl px-2 py-2">
              <Avatar src={g.avatarUrl} name={g.name} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-900">{g.userId === currentUserId ? 'Du' : g.name}</span>
              <span className="flex shrink-0 gap-0.5 text-lg">
                {g.keys.map((k) => (
                  <span key={k} role="img" aria-label={labelFor(k)}>
                    {emojiFor(k)}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
