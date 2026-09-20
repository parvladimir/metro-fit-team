// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMarkdown } from '@/components/chat/ChatMarkdown';
import { CreatorMessageCard } from '@/components/chat/CreatorMessageCard';

const T = { userId: 't', text: '@Thorsten Roloff' };
const render = (text: string, mentions = [T], me: string | null = null) =>
  renderToStaticMarkup(createElement(ChatMarkdown, { text, mentions, currentUserId: me }));

describe('D. highlighting', () => {
  it('wraps the resolved mention in a highlighted span', () => {
    const html = render('@Thorsten Roloff kannst du das bitte testen?');
    expect(html).toContain('data-mention="t"');
    expect(html).toContain('@Thorsten Roloff</span>');
    expect(html).toContain('text-brand');
  });
  it('my own mention is more prominent', () => {
    expect(render('@Thorsten Roloff hi', [T], 't')).toContain('ring-1');
    expect(render('@Thorsten Roloff hi', [T], 'someone-else')).not.toContain('ring-1');
  });
});

describe('H. no false detection', () => {
  it('unresolved @RandomPerson and e-mail addresses stay plain', () => {
    const html = render('@RandomPerson und v.paryacool@gmail.com', [T]);
    expect(html).not.toContain('data-mention');
  });
  it('with no mentions nothing is highlighted', () => {
    expect(render('@Thorsten Roloff', [])).not.toContain('data-mention');
  });
});

describe('I. Markdown + mention', () => {
  it('bold lead-in and mention', () => {
    const html = render('**Wichtig:** @Thorsten Roloff kannst du das morgen prüfen?');
    expect(html).toContain('<strong');
    expect(html).toContain('data-mention="t"');
  });
  it('mentions inside list items and italic', () => {
    const html = render('* @Thorsten Roloff testet\n* *danke* @Thorsten Roloff');
    expect(html).toContain('<ul');
    expect((html.match(/data-mention/g) ?? []).length).toBe(2);
  });
  it('a mention inside a link text or code is not highlighted', () => {
    expect(render('`@Thorsten Roloff`')).not.toContain('data-mention');
    expect(render('[@Thorsten Roloff](https://a.de)')).not.toContain('data-mention');
  });
  it('raw HTML spans cannot fake a mention', () => {
    const html = render('<span data-mention="t">@Fake</span>');
    expect(html).not.toContain('data-mention');
  });
  it('creator card shows the highlight too', () => {
    const html = renderToStaticMarkup(
      createElement(CreatorMessageCard, { name: 'Volodymyr Parashchak', avatar: null, content: '@Thorsten Roloff bitte testen', time: '21:35', onReply: () => {}, mentions: [T], currentUserId: 't' }),
    );
    expect(html).toContain('data-mention="t"');
    expect(html).toContain('Super Admin');
  });
});

describe('E. removed users (15)', () => {
  it('a mention of someone who left still renders as readable text', () => {
    const html = render('Danke @Thorsten Roloff!');
    expect(html).toContain('Thorsten Roloff');
  });
});
