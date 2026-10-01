'use client';

import { useState } from 'react';
import { setReactionAction } from '@/app/(app)/team/chat/actions';
import { applyReactionToggle, type ReactionKey, type ReactionsByUser } from '@/lib/reactions';

/** Shared optimistic reaction state for a team-activity surface outside
 * ChatRoom.tsx (Home's "Heute im Team" card, the fuller `/team/aktivitaet`
 * list) — the same optimistic-update + revert-on-failure pattern
 * ChatRoom's own `setReaction` uses, just without its Realtime subscription:
 * these are revisit-and-refresh screens, not a long-lived live view, so a
 * plain refetch on next navigation is enough for v1. */
export function useTeamReactions(initial: Record<string, ReactionsByUser>, currentUserId: string) {
  const [reactions, setReactions] = useState(initial);

  async function onReactionChange(messageId: string, key: ReactionKey, active: boolean) {
    setReactions((prev) => ({ ...prev, [messageId]: applyReactionToggle(prev[messageId] ?? {}, currentUserId, key, active) }));
    function revert() {
      setReactions((prev) => {
        const mine = prev[messageId]?.[currentUserId] ?? [];
        if (mine.includes(key) !== active) return prev;
        return { ...prev, [messageId]: applyReactionToggle(prev[messageId] ?? {}, currentUserId, key, !active) };
      });
    }
    try {
      const res = await setReactionAction(messageId, key, active);
      if (!res.ok) revert();
    } catch {
      revert();
    }
  }

  return { reactions, onReactionChange };
}
