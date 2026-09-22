// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMarkdown } from '@/components/chat/ChatMarkdown';
import { CreatorMessageCard } from '@/components/chat/CreatorMessageCard';

const T = { userId: 't', text: '@Thorsten Roloff' };

function render(text: string, tone: 'card' | 'bubble' | 'bubble-own' = 'card') {
  return renderToStaticMarkup(createElement(ChatMarkdown, { text, tone }));
}

const FIXTURE = [
  'Hallo zusammen!',
  '',
  'Ihr könnt eure **Trainingspläne als Vorlage speichern**.',
  '',
  'Die Funktion findet ihr unter „Meine Vorlagen“. Mit',
  '„Aus Vorlage erstellen“ übernehmt ihr die Übungen für einen neuen Tag.',
  '',
  '- **Übungen und Ziele** werden übernommen.',
  '- Eure eigene Kopie bleibt **unabhängig vom Original**.',
  '- Den Plan "Push A" könnt ihr anschließend anpassen.',
  '',
  '**Wichtig:** Beim Speichern einer Vorlage werden keine Punkte vergeben.',
].join('\n');

describe('bold emphasis', () => {
  it('renders bold words with the soft-cyan token, semantic <strong> kept', () => {
    const html = render('Das ist **wichtig**.');
    expect(html).toContain('<strong');
    expect(html).toContain('text-[var(--chat-strong)]');
    expect(html).toContain('wichtig');
  });

  it('renders a long bold sentence intact', () => {
    const html = render('**Eure eigene Kopie bleibt unabhängig vom Original und kann frei angepasst werden.**');
    expect(html).toContain('Eure eigene Kopie bleibt unabhängig vom Original und kann frei angepasst werden.');
    expect((html.match(/<strong/g) ?? []).length).toBe(1);
  });

  it('does not bold plain numbers or names on its own', () => {
    const html = render('Tim hat 100 Punkte.');
    expect(html).not.toContain('<strong');
  });
});

describe('inline quoted phrases', () => {
  it('wraps all four supported quote styles in a data-quote span', () => {
    for (const text of ['Unter „Meine Vorlagen“ zu finden.', 'Tippe auf "Speichern".', 'Der Plan "Push A" ist da.', 'Klicke «Weiter».']) {
      const html = render(text);
      expect(html).toContain('data-quote="true"');
      expect(html).toContain('text-[var(--chat-inline-quote)]');
    }
  });

  it('keeps the original quotation marks visible', () => {
    const html = render('Unter „Meine Vorlagen“ zu finden.');
    expect(html).toMatch(/„Meine Vorlagen“<\/span>|<span[^>]*data-quote="true"[^>]*>„Meine Vorlagen“/);
  });

  it('styles a quoted phrase inside a list item', () => {
    const html = render('- Tippe auf „Als Vorlage speichern“.');
    expect(html).toContain('<ul');
    expect(html).toContain('data-quote="true"');
  });

  it('bold and a separate quote in the same message both render correctly, independently', () => {
    const html = render('**Übungen und Ziele** werden übernommen. Danach „Speichern“ tippen.');
    expect(html).toContain('text-[var(--chat-strong)]');
    expect(html).toContain('data-quote="true"');
    expect((html.match(/<strong/g) ?? []).length).toBe(1);
    expect((html.match(/data-quote="true"/g) ?? []).length).toBe(1);
  });
});

describe('conservative detection', () => {
  it('an unmatched opening quote is left as plain readable text', () => {
    const html = render('Das war „komisch, ohne Ende.');
    expect(html).not.toContain('data-quote');
    expect(html).toContain('komisch, ohne Ende');
  });

  it('an apostrophe in a word is never treated as a quote', () => {
    const html = render("Das ist Tim's Plan.");
    expect(html).not.toContain('data-quote');
  });

  it('a measurement like 27" is never treated as a quote', () => {
    const html = render('Der Monitor ist 27" groß.');
    expect(html).not.toContain('data-quote');
    expect(html).toContain('27&quot; groß');
  });

  it('quote marks inside inline code are left alone', () => {
    const html = render('Nutze `„config“` im Code.');
    expect(html).not.toContain('data-quote');
    expect(html).toContain('<code');
  });

  it('quote-like characters inside a link are never split or styled', () => {
    const html = render('[„Mein Link“](https://example.com)');
    expect(html).not.toContain('data-quote');
    expect(html).toContain('<a ');
  });

  it('an email address is never touched', () => {
    const html = render('Schreib an team@example.com bitte.');
    expect(html).not.toContain('data-quote');
    expect(html).toContain('team@example.com');
  });
});

describe('mentions stay distinct from quotes', () => {
  it('a mention and a quote in the same message both resolve to their own span kind', () => {
    const html = renderToStaticMarkup(
      createElement(ChatMarkdown, { text: '@Thorsten Roloff bitte „Speichern“ testen', tone: 'card', mentions: [T], currentUserId: null }),
    );
    expect(html).toContain('data-mention="t"');
    expect(html).toContain('data-quote="true"');
  });

  it('a mention name is found even nested inside a quoted phrase', () => {
    const html = renderToStaticMarkup(
      createElement(ChatMarkdown, { text: '„Sag @Thorsten Roloff Bescheid“', tone: 'card', mentions: [T], currentUserId: null }),
    );
    expect(html).toContain('data-quote="true"');
    expect(html).toContain('data-mention="t"');
  });
});

describe('security', () => {
  it('HTML inside a quoted phrase can never execute or inject markup', () => {
    const html = render('„<img src=x onerror=alert(1)>“');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror');
  });

  it('a raw HTML span cannot fake a quote span', () => {
    const html = render('<span data-quote="true">@Fake</span>');
    expect(html).not.toContain('data-quote');
  });
});

describe('tone-specific color scoping', () => {
  it('the default/card/bubble tones use the light-on-dark tokens (no per-message override)', () => {
    expect(render('**x**', 'card')).not.toContain('--chat-strong:');
    expect(render('**x**', 'bubble')).not.toContain('--chat-strong:');
  });

  it('bubble-own overrides both tokens to a dark, readable navy scoped to that message only', () => {
    const html = render('**x** „y“', 'bubble-own');
    expect(html).toContain('--chat-strong:#00232A');
    expect(html).toContain('--chat-inline-quote:#0b3b57');
  });
});

describe('plain messages', () => {
  it('a message with no Markdown and no quotes renders unchanged', () => {
    const html = render('Hallo zusammen!');
    expect(html).not.toContain('<strong');
    expect(html).not.toContain('data-quote');
    expect(html).toContain('Hallo zusammen!');
  });
});

describe('visual fixture (section 9)', () => {
  it('renders every bold phrase and every quoted phrase in a normal bubble', () => {
    const html = render(FIXTURE, 'bubble');
    expect((html.match(/<strong/g) ?? []).length).toBe(4);
    expect((html.match(/data-quote="true"/g) ?? []).length).toBe(3);
    expect(html).toContain('Trainingspläne als Vorlage speichern');
    expect(html).toContain('„Meine Vorlagen“');
    expect(html).toContain('„Aus Vorlage erstellen“');
    expect(html).toContain('&quot;Push A&quot;');
  });

  it('renders the same fixture inside a Creator card', () => {
    const html = renderToStaticMarkup(
      createElement(CreatorMessageCard, { name: 'Volodymyr Parashchak', avatar: null, content: FIXTURE, time: '21:35', onReply: () => {} }),
    );
    expect((html.match(/<strong/g) ?? []).length).toBe(4);
    expect((html.match(/data-quote="true"/g) ?? []).length).toBe(3);
  });

  it('renders the same fixture on the bright cyan own-bubble with the dark override active', () => {
    const html = render(FIXTURE, 'bubble-own');
    expect(html).toContain('--chat-strong:#00232A');
    expect((html.match(/<strong/g) ?? []).length).toBe(4);
    expect((html.match(/data-quote="true"/g) ?? []).length).toBe(3);
  });
});
