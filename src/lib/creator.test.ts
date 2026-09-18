import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CreatorMessageCard } from '@/components/chat/CreatorMessageCard';
import { fetchCreators, isCreatorCardMessage, linkify } from './creator';

describe('creator card eligibility (identity, not name)', () => {
  const creator = { displayName: 'Volodymyr Parashchak' };
  it('text and image messages from a verified creator get the card', () => {
    expect(isCreatorCardMessage({ message_type: 'text' }, creator)).toBe(true);
    expect(isCreatorCardMessage({ message_type: 'image' }, creator)).toBe(true);
  });
  it('G. system events never get it, even from the creator', () => {
    expect(isCreatorCardMessage({ message_type: 'system' }, creator)).toBe(false);
  });
  it('D/F. non-creators (any name, incl. a namesake) get no card', () => {
    expect(isCreatorCardMessage({ message_type: 'text' }, null)).toBe(false);
    expect(isCreatorCardMessage({ message_type: 'text' }, undefined)).toBe(false);
  });
});

describe('fetchCreators is keyed by user id', () => {
  const fake = (rows: { user_id: string; display_name: string }[]) =>
    ({ from: () => ({ select: () => ({ in: (_c: string, ids: string[]) => Promise.resolve({ data: rows.filter((r) => ids.includes(r.user_id)) }) }) }) }) as never;

  it('recognises only listed ids; a renamed/duplicated display name is irrelevant', async () => {
    const db = fake([{ user_id: 'creator-id', display_name: 'Volodymyr Parashchak' }]);
    const map = await fetchCreators(db, ['creator-id', 'namesake-id']);
    expect(map.get('creator-id')?.displayName).toBe('Volodymyr Parashchak');
    expect(map.has('namesake-id')).toBe(false);
  });
  it('empty input needs no query', async () => {
    expect((await fetchCreators({} as never, [])).size).toBe(0);
  });
});

describe('linkify', () => {
  it('extracts http(s) links, keeps trailing punctuation outside', () => {
    expect(linkify('Siehe https://metro-fit-team.vercel.app/plan.')).toEqual([
      { type: 'text', value: 'Siehe ' },
      { type: 'link', value: 'https://metro-fit-team.vercel.app/plan', href: 'https://metro-fit-team.vercel.app/plan' },
      { type: 'text', value: '.' },
    ]);
  });
  it('never links javascript: or other schemes', () => {
    expect(linkify('javascript:alert(1) und data:text/html,x')).toEqual([{ type: 'text', value: 'javascript:alert(1) und data:text/html,x' }]);
  });
  it('plain text passes through', () => expect(linkify('Hallo')).toEqual([{ type: 'text', value: 'Hallo' }]));
});

describe('CreatorMessageCard markup', () => {
  const html = renderToStaticMarkup(
    createElement(CreatorMessageCard, {
      name: 'Volodymyr Parashchak',
      avatar: null,
      content: 'Neue Funktion:\n\nTrainingspläne unterstützen Distanz. <b>x</b> https://a.de/x',
      time: '21:35',
      onReply: () => {},
    }),
  );
  it('shows name, both text badges and time', () => {
    expect(html).toContain('Volodymyr Parashchak');
    expect(html).toContain('Super Admin');
    expect(html).toContain('Creator');
    expect(html).toContain('21:35');
  });
  it('preserves paragraphs, wraps safely, escapes HTML, opens links safely', () => {
    expect(html).toContain('whitespace-pre-wrap');
    expect(html).toContain('break-words');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('font-creator');
  });
  it('renders an attachment inside the card', () => {
    const withImg = renderToStaticMarkup(
      createElement(CreatorMessageCard, { name: 'V', avatar: null, content: '', time: '1', onReply: () => {} }, createElement('img', { alt: 'shot', src: 'x' })),
    );
    expect(withImg).toContain('alt="shot"');
  });
});
