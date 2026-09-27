/** Centralized 20-reaction allowlist + pure helpers. Stable IDs are used for
 * validation and storage everywhere (DB check constraint, RPC, client) — never
 * a translated label. The renderer always resolves an ID through this list. */

export type ReactionKey =
  | 'thumbs_up'
  | 'heart'
  | 'fire'
  | 'muscle'
  | 'clap'
  | 'laugh'
  | 'smile'
  | 'heart_eyes'
  | 'cool'
  | 'star_struck'
  | 'surprised'
  | 'thinking'
  | 'sad'
  | 'sweat_smile'
  | 'raised_hands'
  | 'thanks'
  | 'party'
  | 'trophy'
  | 'hundred'
  | 'rocket';

export interface ReactionDef {
  key: ReactionKey;
  emoji: string;
  label: string;
}

export const REACTIONS: ReactionDef[] = [
  { key: 'thumbs_up', emoji: '👍', label: 'Daumen hoch' },
  { key: 'heart', emoji: '❤️', label: 'Herz' },
  { key: 'fire', emoji: '🔥', label: 'Feuer' },
  { key: 'muscle', emoji: '💪', label: 'Muskel' },
  { key: 'clap', emoji: '👏', label: 'Applaus' },
  { key: 'laugh', emoji: '😂', label: 'Lachtränen' },
  { key: 'smile', emoji: '😊', label: 'Lächeln' },
  { key: 'heart_eyes', emoji: '😍', label: 'Herzaugen' },
  { key: 'cool', emoji: '😎', label: 'Cool' },
  { key: 'star_struck', emoji: '🤩', label: 'Begeistert' },
  { key: 'surprised', emoji: '😮', label: 'Überrascht' },
  { key: 'thinking', emoji: '🤔', label: 'Nachdenklich' },
  { key: 'sad', emoji: '😢', label: 'Traurig' },
  { key: 'sweat_smile', emoji: '😅', label: 'Schwitzen' },
  { key: 'raised_hands', emoji: '🙌', label: 'Jubel' },
  { key: 'thanks', emoji: '🙏', label: 'Danke' },
  { key: 'party', emoji: '🎉', label: 'Party' },
  { key: 'trophy', emoji: '🏆', label: 'Pokal' },
  { key: 'hundred', emoji: '💯', label: 'Hundert' },
  { key: 'rocket', emoji: '🚀', label: 'Los geht’s' },
];

export const QUICK_REACTIONS: ReactionKey[] = REACTIONS.slice(0, 6).map((r) => r.key);

const REACTION_MAP: Record<string, ReactionDef> = Object.fromEntries(REACTIONS.map((r) => [r.key, r]));

export function isReactionKey(value: string | null | undefined): value is ReactionKey {
  return !!value && value in REACTION_MAP;
}

export function emojiFor(key: string | null | undefined): string {
  return (key && REACTION_MAP[key]?.emoji) || '❤️';
}

export function labelFor(key: string | null | undefined): string {
  return (key && REACTION_MAP[key]?.label) || 'Reaktion';
}

/** Per-message state: EVERY key each user currently has active — a user may
 * hold several of the 20 at once, each an independent toggle. No duplicates
 * within one user's list; order is insignificant (allowlist order is applied
 * only when rendering, in `summarizeReactions`). */
export type ReactionsByUser = Record<string, ReactionKey[]>;

export const EMPTY_REACTIONS: ReactionsByUser = {};

/** Idempotent per-key toggle: applying the same (userId, key, active) any
 * number of times — from an optimistic update, its own Realtime echo, or a
 * stale duplicate event — converges to the same state instead of
 * double-counting or flipping back. Touches only this one key; every other
 * key already active for this user (or any other user) is untouched. */
export function applyReactionToggle(state: ReactionsByUser, userId: string, key: ReactionKey, active: boolean): ReactionsByUser {
  const current = state[userId] ?? [];
  const has = current.includes(key);
  if (active === has) return state;
  const next = active ? [...current, key] : current.filter((k) => k !== key);
  if (next.length === 0) {
    if (!(userId in state)) return state;
    const rest = { ...state };
    delete rest[userId];
    return rest;
  }
  return { ...state, [userId]: next };
}

export interface ReactionCount {
  key: ReactionKey;
  count: number;
}

/** Nonzero chips only, in the fixed allowlist order — so chips never jump
 * around as counts change. Counts distinct REACTIONS, not distinct people:
 * one person holding both 👍 and 🔥 contributes 1 to each count, not 2 to
 * either. */
export function summarizeReactions(state: ReactionsByUser): ReactionCount[] {
  const counts = new Map<ReactionKey, number>();
  for (const keys of Object.values(state)) {
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return REACTIONS.filter((r) => counts.has(r.key)).map((r) => ({ key: r.key, count: counts.get(r.key)! }));
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || 'Jemand';
}

/** Push/in-app wording. `isWorkoutEvent` defaults true so historical data with
 * no recorded target type (backfilled from the single pre-existing reaction
 * type, which was always on a workout event) renders the way it always did. */
export function reactionText(actorName: string, key: ReactionKey, isWorkoutEvent = true, eventTitle?: string | null): string {
  const who = firstName(actorName);
  const emoji = emojiFor(key);
  if (isWorkoutEvent) {
    return eventTitle
      ? `${who} hat mit ${emoji} auf dein Training „${eventTitle}“ reagiert.`
      : `${who} hat mit ${emoji} auf dein Training reagiert.`;
  }
  return `${who} hat mit ${emoji} auf deine Nachricht reagiert.`;
}
