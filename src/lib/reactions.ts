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

/** Per-message state: which key (if any) each user currently has selected. A
 * sparse map, not a per-key array — this is what makes insert/replace/remove
 * a single uniform "set this user's entry" operation instead of three. */
export type ReactionsByUser = Record<string, ReactionKey>;

export const EMPTY_REACTIONS: ReactionsByUser = {};

/** Idempotent merge: applying the same (userId, key) pair any number of times
 * — from an optimistic update, its own Realtime echo, or a stale duplicate
 * event — converges to the same state instead of double-counting. */
export function applyReactionChange(state: ReactionsByUser, userId: string, key: ReactionKey | null): ReactionsByUser {
  if (key === null) {
    if (!(userId in state)) return state;
    const next = { ...state };
    delete next[userId];
    return next;
  }
  if (state[userId] === key) return state;
  return { ...state, [userId]: key };
}

export interface ReactionCount {
  key: ReactionKey;
  count: number;
}

/** Nonzero chips only, in the fixed allowlist order — so chips never jump
 * around as counts change. */
export function summarizeReactions(state: ReactionsByUser): ReactionCount[] {
  const counts = new Map<ReactionKey, number>();
  for (const key of Object.values(state)) counts.set(key, (counts.get(key) ?? 0) + 1);
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
