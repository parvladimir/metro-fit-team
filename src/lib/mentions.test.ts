import { describe, expect, it } from 'vitest';
import { filterMembers, findMentionQuery, findMentionRanges, insertMention, resolveMentions, splitByMentions, stillMentioned, type MentionMember } from './mentions';

const M = (id: string, name: string): MentionMember => ({ id, name, avatarUrl: null });
const members = [M('t', 'Thorsten Roloff'), M('v', 'Volodymyr Parashchak'), M('d', 'Dennis Meier'), M('o', 'Özcan Yilmaz')];

describe('A/B. autocomplete trigger and filtering', () => {
  it('typing @ opens the list with everyone', () => {
    expect(findMentionQuery('Hallo @', 7)).toEqual({ start: 6, query: '' });
    expect(filterMembers(members, '').length).toBe(4);
  });
  it('@tho filters to Thorsten', () => {
    const q = findMentionQuery('@tho', 4)!;
    expect(filterMembers(members, q.query).map((m) => m.name)).toEqual(['Thorsten Roloff']);
  });
  it('matches any word of the name and ignores diacritics', () => {
    expect(filterMembers(members, 'rol').map((m) => m.id)).toEqual(['t']);
    expect(filterMembers(members, 'ozc').map((m) => m.id)).toEqual(['o']);
  });
  it('prefix matches rank before substring matches', () => {
    expect(filterMembers([M('a', 'Marta'), M('b', 'Tamara')], 'ta').map((m) => m.id)).toEqual(['b', 'a']);
  });
  it('works while a second word is being typed', () => {
    const q = findMentionQuery('@Thorsten Ro', 12)!;
    expect(filterMembers(members, q.query).map((m) => m.id)).toEqual(['t']);
  });
});

describe('H. e-mail addresses and stray @ never trigger', () => {
  it('a@b in an address', () => {
    expect(findMentionQuery('v.paryacool@gmail.com', 21)).toBeNull();
    expect(findMentionQuery('mail an x@y', 11)).toBeNull();
  });
  it('closed by newline or too long', () => {
    expect(findMentionQuery('@a\nb', 4)).toBeNull();
    expect(findMentionQuery('@' + 'x'.repeat(40), 41)).toBeNull();
  });
  it('after an opening bracket or a line start it does', () => {
    expect(findMentionQuery('(@Th', 4)).toEqual({ start: 1, query: 'Th' });
    expect(findMentionQuery('Zeile\n@Th', 9)).toEqual({ start: 6, query: 'Th' });
  });
});

describe('C. insertion', () => {
  it('replaces @query with the full name and a trailing space', () => {
    const text = 'Hey @tho kannst du testen?';
    const q = findMentionQuery(text, 8)!;
    const r = insertMention(text, q, 8, 'Thorsten Roloff');
    expect(r.text).toBe('Hey @Thorsten Roloff kannst du testen?');
    expect(r.caret).toBe('Hey @Thorsten Roloff '.length);
  });
  it('at the end of the text it appends a space', () => {
    const q = findMentionQuery('@d', 2)!;
    expect(insertMention('@d', q, 2, 'Dennis Meier')).toEqual({ text: '@Dennis Meier ', caret: 14 });
  });
});

describe('rendering ranges: only resolved mentions', () => {
  const mentions = [{ userId: 't', text: '@Thorsten Roloff' }];
  it('highlights the resolved mention, not arbitrary @Names', () => {
    const parts = splitByMentions('@Thorsten Roloff und @RandomPerson', mentions);
    expect(parts).toEqual([
      { type: 'mention', value: '@Thorsten Roloff', userId: 't' },
      { type: 'text', value: ' und @RandomPerson' },
    ]);
  });
  it('an e-mail address containing the name text is not a mention', () => {
    expect(splitByMentions('mail@Thorsten Roloff.de', mentions)).toEqual([{ type: 'text', value: 'mail@Thorsten Roloff.de' }]);
  });
  it('does not match inside a longer word', () => {
    expect(findMentionRanges('@Thorsten Roloffs Hund', mentions)).toEqual([]);
  });
  it('longer names win and punctuation after a mention is fine', () => {
    const ms = [{ userId: 'a', text: '@Anna' }, { userId: 'm', text: '@Anna Maria' }];
    expect(findMentionRanges('@Anna Maria, hallo @Anna!', ms).map((r) => r.userId)).toEqual(['m', 'a']);
  });
  it('same mention twice highlights both', () => {
    expect(findMentionRanges('@Thorsten Roloff ja @Thorsten Roloff', mentions)).toHaveLength(2);
  });
  it('no mentions → untouched text', () => {
    expect(splitByMentions('Hallo Welt', [])).toEqual([{ type: 'text', value: 'Hallo Welt' }]);
  });
});

describe('composer: which selections survive editing the text', () => {
  it('drops a mention whose text was deleted', () => {
    expect(stillMentioned('Hallo', [M('t', 'Thorsten Roloff')])).toEqual([]);
    expect(stillMentioned('Hallo @Thorsten Roloff', [M('t', 'Thorsten Roloff')]).map((m) => m.id)).toEqual(['t']);
  });
});

describe('G. server-side resolution (no forging)', () => {
  const team = [{ id: 't', name: 'Thorsten Roloff' }, { id: 'me', name: 'Ich' }];
  it('keeps real team members whose text is in the message', () => {
    expect(resolveMentions('Hi @Thorsten Roloff!', ['t'], team, 'me')).toEqual([{ userId: 't', text: '@Thorsten Roloff' }]);
  });
  it('drops a user from another team / arbitrary id (not in the member list)', () => {
    expect(resolveMentions('Hi @Fremd Person', ['x'], team, 'me')).toEqual([]);
  });
  it('drops a member whose name is not in the text, and yourself', () => {
    expect(resolveMentions('Hi', ['t'], team, 'me')).toEqual([]);
    expect(resolveMentions('@Ich', ['me'], team, 'me')).toEqual([]);
  });
  it('dedupes and caps requested ids', () => {
    expect(resolveMentions('@Thorsten Roloff', ['t', 't', 't'], team, 'me')).toHaveLength(1);
  });
  it('markdown around the mention is fine', () => {
    expect(resolveMentions('**Wichtig:** @Thorsten Roloff kannst du das morgen prüfen?', ['t'], team, 'me')).toHaveLength(1);
  });
});
