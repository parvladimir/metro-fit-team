// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMarkdown } from '@/components/chat/ChatMarkdown';
import { CreatorMessageCard } from '@/components/chat/CreatorMessageCard';
import { clipboardToMarkdown, normalizePlainPaste, stripMarkdown } from './chat-format';

const UPDATE = `Hallo zusammen 👋

es gab wieder einige Verbesserungen und neue Funktionen in der App:

* Eigene Übungen können jetzt erstellt werden, wenn etwas im Übungskatalog fehlt.
* Je nach Trainingsart werden jetzt passende Werte erfasst (z. B. Distanz, Zeit, Pace).
* Trainingsziele können im Plan übersichtlicher vorbereitet werden.
* Im Team-Chat können jetzt **Fotos** und *Screenshots* geteilt werden.

Wenn euch noch etwas auffällt, schreibt mir gerne. Mehr: https://metro-fit-team.vercel.app/plan.`;

const render = (text: string) => renderToStaticMarkup(createElement(ChatMarkdown, { text }));
const parse = (h: string) => new DOMParser().parseFromString(h, 'text/html').body;

describe('rendering the real update message', () => {
  const html = render(UPDATE);
  it('renders a real bullet list, no visible markdown syntax', () => {
    expect(html).toContain('<ul');
    expect((html.match(/<li/g) ?? []).length).toBe(4);
    expect(html).not.toMatch(/>\s*\*\s/);
    expect(html).not.toContain('**');
  });
  it('paragraph spacing: intro, lead-in and closing are separate paragraphs', () => {
    expect((html.match(/<p/g) ?? []).length).toBe(3);
    expect(html).toContain('Hallo zusammen 👋');
  });
  it('bold, italic and links', () => {
    expect(html).toContain('<strong');
    expect(html).toContain('Fotos');
    expect(html).toContain('<em');
    expect(html).toContain('href="https://metro-fit-team.vercel.app/plan"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });
  it('the same formatting works in the creator card', () => {
    const card = renderToStaticMarkup(
      createElement(CreatorMessageCard, { name: 'Volodymyr Parashchak', avatar: null, content: UPDATE, time: '21:35', onReply: () => {} }),
    );
    expect(card).toContain('<ul');
    expect(card).toContain('Super Admin');
    expect(card).not.toContain('* Eigene');
  });
});

describe('lists', () => {
  it('"- item" and "* item" and "1. item" become lists', () => {
    expect(render('- a\n- b')).toContain('<ul');
    expect(render('* a\n* b')).toContain('<ul');
    expect(render('1. a\n2. b')).toContain('<ol');
  });
  it('a list directly after a sentence still renders as a list', () => {
    expect(render('Neu:\n* a\n* b')).toContain('<ul');
  });
});

describe('old plain-text messages', () => {
  it('render as before: text and single line breaks preserved', () => {
    const html = render('Hallo\nwie geht es?');
    expect(html).toContain('Hallo');
    expect(html).toContain('<br');
    expect(render('Stark! Viel Erfolg 💪')).toContain('Stark! Viel Erfolg 💪');
  });
  it('underscores inside words and math stay plain', () => {
    expect(render('snake_case_word und 5 * 3')).toContain('snake_case_word');
  });
});

describe('sanitizing', () => {
  it('raw HTML is never rendered', () => {
    const html = render('<script>alert(1)</script><img src=x onerror=alert(1)><b onclick="x()">fett</b>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('onclick');
  });
  it('javascript:/data: links are not clickable', () => {
    for (const bad of ['[x](javascript:alert(1))', '[x](data:text/html;base64,AAAA)', '[x](vbscript:1)']) {
      expect(render(bad)).not.toMatch(/href="(javascript|data|vbscript):/);
    }
  });
  it('headings/images/tables collapse to plain text', () => {
    const html = render('# Titel\n\n![bild](https://a.de/x.png)');
    expect(html).not.toContain('<h1');
    expect(html).not.toContain('<img');
  });
});

describe('paste conversion (ChatGPT-style HTML → Markdown)', () => {
  const chatgpt =
    '<p>Hallo zusammen 👋</p><p>es gab Neuerungen:</p><ul><li>Eigene <strong>Übungen</strong> erstellen</li><li>Fotos im <em>Chat</em></li></ul><p>Mehr: <a href="https://metro-fit-team.vercel.app">App</a></p>';
  it('produces clean Markdown, no HTML', () => {
    const md = clipboardToMarkdown({ html: chatgpt, text: 'ignored' }, parse);
    expect(md).toBe(
      'Hallo zusammen 👋\n\nes gab Neuerungen:\n\n- Eigene **Übungen** erstellen\n- Fotos im *Chat*\n\nMehr: [App](https://metro-fit-team.vercel.app)',
    );
    expect(md).not.toContain('<');
  });
  it('round-trips into a rendered list', () => {
    const html = render(clipboardToMarkdown({ html: chatgpt, text: '' }, parse));
    expect((html.match(/<li/g) ?? []).length).toBe(2);
  });
  it('nested lists and ordered lists', () => {
    const md = clipboardToMarkdown({ html: '<ol><li>Eins<ul><li>a</li></ul></li><li>Zwei</li></ol>', text: '' }, parse);
    expect(md).toBe('1. Eins\n  - a\n2. Zwei');
  });
  it('drops unsafe links and scripts', () => {
    const md = clipboardToMarkdown({ html: '<p><a href="javascript:alert(1)">klick</a><script>x()</script></p>', text: '' }, parse);
    expect(md).toBe('klick');
  });
  it('Google-Docs style <b font-weight:normal> wrapper is not bolded', () => {
    const md = clipboardToMarkdown({ html: '<b style="font-weight:normal"><p>Text</p></b>', text: '' }, parse);
    expect(md).toBe('Text');
  });
  it('plain-text fallback converts • bullets and CRLF', () => {
    expect(clipboardToMarkdown({ html: '', text: 'Neu:\r\n• a\r\n• b\r\n\r\n\r\n\r\nEnde' }, parse)).toBe('Neu:\n- a\n- b\n\nEnde');
    expect(normalizePlainPaste('  ◦ eins')).toBe('- eins');
  });
});

describe('stripMarkdown (push preview)', () => {
  it('removes syntax', () => {
    expect(stripMarkdown('**Neu**\n\n* Fotos\n* [Link](https://a.de)')).toBe('Neu • Fotos • Link');
  });
});
