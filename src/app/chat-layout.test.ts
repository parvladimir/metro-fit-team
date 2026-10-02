// The chat page scrolls its message list, not the document. That needs two things to agree, in two files: the chat page
// marks its root `data-fills-viewport`, and globals.css bounds the app shell to one viewport for such a page. jsdom has
// no layout, so this guards the agreement between them; that the list really is the scroller at phone widths is checked
// in a real browser.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...parts: string[]) => readFileSync(join(process.cwd(), 'src', 'app', ...parts), 'utf8');
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const body = (css: string, selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? null;
};

describe('the chat page owns its scrolling', () => {
  const css = withoutComments(read('globals.css'));

  it('bounds the app shell to one viewport for a page that marks itself', () => {
    const rule = body(css, '.app-shell:has([data-fills-viewport])');
    expect(rule).not.toBeNull();
    expect(rule).toMatch(/height:\s*100dvh/);
  });

  it('leaves every other page free to grow: the plain shell has a min-height, never a fixed height', () => {
    const rule = body(css, '.app-shell');
    expect(rule).toMatch(/min-height:\s*100dvh/);
    expect(rule).not.toMatch(/(^|[\s;])height:/);
  });

  it('is marked by the chat page, on the outermost element of the page itself (not of the "no team" notice)', () => {
    const page = read('(app)', 'team', 'chat', 'page.tsx');
    const roots = [...page.matchAll(/return \(\s*(?:\/\/[^\n]*\n\s*)*<div ([^>]*)>/g)].map((m) => m[1]);
    const chat = roots[roots.length - 1];
    expect(chat).toContain('data-fills-viewport');
    // the flex chain below it must be allowed to shrink, or the list cannot become the scroller
    expect(chat).toMatch(/min-h-0/);
    expect(roots.slice(0, -1).join(' ')).not.toContain('data-fills-viewport');
  });
});
