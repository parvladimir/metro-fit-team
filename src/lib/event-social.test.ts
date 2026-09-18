import { describe, expect, it } from 'vitest';
import {
  addReplyOnce,
  applyReaction,
  cleanReply,
  eventDeepLink,
  firstName,
  inAppNotificationText,
  isValidMessageId,
  reactionText,
  repliesLabel,
  replyText,
  shouldCollapseReplies,
  type EventReply,
} from './event-social';

const reply = (id: string, at: string): EventReply => ({ id, user_id: 'u', content: 'x', created_at: at, authorName: 'A', authorAvatar: null });

describe('reactions', () => {
  it('adds once, removes once (no duplicates)', () => {
    let r: string[] = [];
    r = applyReaction(r, 'a', true);
    r = applyReaction(r, 'a', true);
    expect(r).toEqual(['a']);
    r = applyReaction(r, 'b', true);
    expect(r).toEqual(['a', 'b']);
    r = applyReaction(r, 'a', false);
    r = applyReaction(r, 'a', false);
    expect(r).toEqual(['b']);
  });
});

describe('reply thread', () => {
  it('dedupes an optimistic reply that also arrives via realtime', () => {
    const r1 = reply('1', '2026-01-01T10:00:00Z');
    let list = addReplyOnce([], r1);
    list = addReplyOnce(list, r1);
    expect(list).toHaveLength(1);
  });
  it('keeps replies ordered oldest first', () => {
    const list = addReplyOnce([reply('2', '2026-01-01T10:05:00Z')], reply('1', '2026-01-01T10:00:00Z'));
    expect(list.map((r) => r.id)).toEqual(['1', '2']);
  });
  it('J. collapses from 3 replies, shows 0–2 directly, expands on demand', () => {
    expect(shouldCollapseReplies(0, false)).toBe(false);
    expect(shouldCollapseReplies(2, false)).toBe(false);
    expect(shouldCollapseReplies(3, false)).toBe(true);
    expect(shouldCollapseReplies(3, true)).toBe(false);
    expect(repliesLabel(1)).toBe('1 Antwort');
    expect(repliesLabel(3)).toBe('3 Antworten');
  });
  it('cleans and limits reply text', () => {
    expect(cleanReply('   ')).toBeNull();
    expect(cleanReply('  Stark!  ')).toBe('Stark!');
    expect(cleanReply('x'.repeat(900))).toHaveLength(500);
  });
});

describe('notification wording (privacy: name, title, short reply only)', () => {
  it('reaction', () => {
    expect(reactionText('Tim Aigner')).toBe('Tim unterstützt dein Training 💪');
    expect(reactionText('Tim Aigner', 'Beine')).toBe('Tim unterstützt dein Training „Beine“ 💪');
  });
  it('reply with truncated preview', () => {
    expect(replyText('Volodymyr Parashchak', 'Stark! Viel Erfolg 💪')).toBe('Volodymyr hat auf dein Training geantwortet: „Stark! Viel Erfolg 💪“');
    const long = replyText('Tim', 'a'.repeat(300));
    expect(long.length).toBeLessThan(140);
    expect(long).toContain('…');
  });
  it('in-app text', () => {
    expect(inAppNotificationText('reaction', { actor_name: 'Tim Aigner' })).toBe('Tim unterstützt dein Training.');
    expect(inAppNotificationText('reply', { actor_name: 'Volodymyr Parashchak' })).toBe('Volodymyr hat auf dein Training geantwortet.');
  });
  it('first name fallback', () => expect(firstName('  ')).toBe('Jemand'));
});

describe('deep link', () => {
  it('points to the team chat with the event id', () => {
    const id = '1d28b13b-575c-488e-bc71-11f447c4915e';
    expect(eventDeepLink(id)).toBe(`/team/chat?message=${id}`);
    expect(isValidMessageId(id)).toBe(true);
  });
  it('rejects malformed ids (no injection into the query)', () => {
    for (const bad of ['', null, undefined, '../x', 'a b', '<script>']) expect(isValidMessageId(bad as never)).toBe(false);
  });
});
