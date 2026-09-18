/** Pure helpers for reactions / replies on team activity events. */

export interface EventReply {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  authorName: string;
  authorAvatar: string | null;
}

export interface EventSocial {
  /** user ids that currently support the event */
  reactors: string[];
  /** one level only: direct replies, oldest first */
  replies: EventReply[];
}

export const EMPTY_SOCIAL: EventSocial = { reactors: [], replies: [] };
export const REPLY_COLLAPSE_THRESHOLD = 3;
export const MAX_REPLY_LENGTH = 500;

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || 'Jemand';
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Push/in-app wording. Only the actor's first name, the workout title and the
 * short reply text — never health data. */
export function reactionText(actorName: string, eventTitle?: string | null): string {
  const who = firstName(actorName);
  return eventTitle ? `${who} unterstützt dein Training „${eventTitle}“ 💪` : `${who} unterstützt dein Training 💪`;
}

export function replyText(actorName: string, reply: string): string {
  return `${firstName(actorName)} hat auf dein Training geantwortet: „${truncate(reply, 80)}“`;
}

export function inAppNotificationText(
  kind: 'reaction' | 'reply' | null,
  params: { actor_name?: string; event_title?: string | null; preview?: string }
): string {
  const who = firstName(params.actor_name ?? '');
  return kind === 'reply' ? `${who} hat auf dein Training geantwortet.` : `${who} unterstützt dein Training.`;
}

export function applyReaction(reactors: string[], userId: string, add: boolean): string[] {
  const has = reactors.includes(userId);
  if (add && !has) return [...reactors, userId];
  if (!add && has) return reactors.filter((id) => id !== userId);
  return reactors;
}

/** Realtime + optimistic inserts can both deliver a reply: keep one. */
export function addReplyOnce(replies: EventReply[], reply: EventReply): EventReply[] {
  if (replies.some((r) => r.id === reply.id)) return replies;
  return [...replies, reply].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** 0–2 replies show directly; 3+ collapse behind "n Antworten anzeigen". */
export function shouldCollapseReplies(count: number, expanded: boolean): boolean {
  return count >= REPLY_COLLAPSE_THRESHOLD && !expanded;
}

export function repliesLabel(count: number): string {
  return count === 1 ? '1 Antwort' : `${count} Antworten`;
}

export function cleanReply(input: string): string | null {
  const text = input.trim().slice(0, MAX_REPLY_LENGTH);
  return text ? text : null;
}

export function eventDeepLink(messageId: string): string {
  return `/team/chat?message=${encodeURIComponent(messageId)}`;
}

export function isValidMessageId(value: string | null | undefined): value is string {
  return !!value && /^[0-9a-f-]{36}$/i.test(value);
}
