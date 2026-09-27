/** Pure helpers for replies on team activity events. Reactions (now shared
 * across every message type, not just events) live in `@/lib/reactions`. */

import { isReactionKey, reactionText } from '@/lib/reactions';

export interface EventReply {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  authorName: string;
  authorAvatar: string | null;
  mentions?: { userId: string; text: string }[];
}

export interface EventSocial {
  /** one level only: direct replies, oldest first */
  replies: EventReply[];
}

export const EMPTY_SOCIAL: EventSocial = { replies: [] };
export const REPLY_COLLAPSE_THRESHOLD = 3;
export const MAX_REPLY_LENGTH = 500;

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || 'Jemand';
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function replyText(actorName: string, reply: string): string {
  return `${firstName(actorName)} hat auf dein Training geantwortet: „${truncate(reply, 80)}“`;
}

export function inAppNotificationText(
  kind: 'reaction' | 'reply' | 'mention' | null,
  params: { actor_name?: string; event_title?: string | null; preview?: string; reaction_key?: string; is_workout?: boolean }
): string {
  const who = firstName(params.actor_name ?? '');
  if (kind === 'mention') return `${who} hat dich im Team-Chat erwähnt.`;
  if (kind === 'reply') return `${who} hat auf dein Training geantwortet.`;
  if (isReactionKey(params.reaction_key)) {
    return reactionText(params.actor_name ?? '', params.reaction_key, params.is_workout ?? true, params.event_title);
  }
  return `${who} unterstützt dein Training.`;
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
