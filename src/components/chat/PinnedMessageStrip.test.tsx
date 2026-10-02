// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PinnedMessageStrip } from './PinnedMessageStrip';
import { MessageActions } from './MessageActions';
import type { PinnedMessage } from '@/lib/chat-pin';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.get(key) ?? null; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, String(value)); }
}

const pin: PinnedMessage = { id: 'm-1', authorName: 'Tim', preview: 'Aktuelle Infos zum Wettbewerb', isImage: false, deleted: false };

let container: HTMLDivElement;
let root: Root;
let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const click = (el: Element | null | undefined) => {
  if (!el) throw new Error('not found');
  act(() => {
    (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};
const byText = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

function strip(over: Partial<Parameters<typeof PinnedMessageStrip>[0]> = {}) {
  const onView = vi.fn();
  const onUnpin = vi.fn();
  act(() => root.render(<PinnedMessageStrip teamId="team-1" pin={pin} canManage={false} busy={false} onView={onView} onUnpin={onUnpin} {...over} />));
  return { onView, onUnpin };
}

describe('PinnedMessageStrip', () => {
  it('stays in view even where the whole page scrolls (a browser without :has(); its offset below the status bar is checked in a real browser: jsdom drops env())', () => {
    strip();
    const section = container.querySelector<HTMLElement>('section[aria-label="Angeheftete Nachricht"]')!;
    expect(section.classList.contains('sticky')).toBe(true);
  });

  it('shows the title, who wrote it and the start of the original message', () => {
    strip();
    const section = container.querySelector('section[aria-label="Angeheftete Nachricht"]')!;
    expect(section.textContent).toContain('Angeheftete Nachricht');
    expect(section.textContent).toContain('Tim: Aktuelle Infos zum Wettbewerb');
  });

  it('"Ansehen" jumps to the original message', () => {
    const { onView } = strip();
    click(byText('Ansehen'));
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it('a photo says so, with its caption when there is one', () => {
    strip({ pin: { ...pin, isImage: true, preview: '' } });
    expect(container.textContent).toContain('Foto');
    strip({ pin: { ...pin, isImage: true, preview: 'Trainingsplan' } });
    expect(container.textContent).toContain('Foto · Trainingsplan');
  });

  it('can be folded into a single row, which is remembered per team on this device', () => {
    strip();
    const toggle = container.querySelector('button[aria-expanded]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-label')).toBe('Angeheftete Nachricht einklappen');
    click(toggle);
    expect(container.textContent).not.toContain('Aktuelle Infos');
    expect(container.textContent).toContain('Angeheftete Nachricht'); // the row itself stays
    expect(byText('Ansehen')).toBeTruthy(); // and still opens the message
    expect(storage.getItem('mft:chat-pin-collapsed:team-1')).toBe('1');

    act(() => root.unmount());
    root = createRoot(container);
    strip(); // a later visit starts folded
    expect(container.textContent).not.toContain('Aktuelle Infos');
    click(container.querySelector('button[aria-expanded]'));
    expect(storage.getItem('mft:chat-pin-collapsed:team-1')).toBe('0');
    expect(container.textContent).toContain('Aktuelle Infos');
  });

  it('works without usable storage', () => {
    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    strip();
    expect(container.textContent).toContain('Aktuelle Infos');
    click(container.querySelector('button[aria-expanded]'));
    expect(container.textContent).not.toContain('Aktuelle Infos');
  });

  it('only a team admin gets "Anheftung aufheben", and only while the strip is open', () => {
    strip({ canManage: false });
    expect(byText('Anheftung aufheben')).toBeUndefined();

    const { onUnpin } = strip({ canManage: true });
    click(byText('Anheftung aufheben'));
    expect(onUnpin).toHaveBeenCalledTimes(1);
    click(container.querySelector('button[aria-expanded]'));
    expect(byText('Anheftung aufheben')).toBeUndefined();
  });

  it('every control is at least 44 px tall', () => {
    strip({ canManage: true });
    for (const b of container.querySelectorAll('button')) expect(b.className, b.textContent ?? '').toMatch(/min-h-\[44px\]|h-11/);
  });
});

describe('MessageActions with pinning', () => {
  function menu(props: Parameters<typeof MessageActions>[0]) {
    act(() => root.render(<MessageActions {...props} />));
  }
  const open = () => click(container.querySelector('button[aria-label="Nachrichtenoptionen"]'));
  const items = () => [...container.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent?.trim());

  it('offers nothing — and renders nothing — to someone who may do nothing', () => {
    menu({});
    expect(container.innerHTML).toBe('');
  });

  it('a regular member\'s own message: edit and delete only, never pin', () => {
    menu({ onEdit: vi.fn(), onDelete: vi.fn() });
    open();
    expect(items()).toEqual(['Bearbeiten', 'Löschen']);
  });

  it('an admin on someone else\'s message: pin only — no edit, no delete', () => {
    menu({ pin: { pinned: false, onToggle: vi.fn() } });
    open();
    expect(items()).toEqual(['Anheften']);
  });

  it('an admin on their own message: pin plus edit and delete', () => {
    menu({ onEdit: vi.fn(), onDelete: vi.fn(), pin: { pinned: false, onToggle: vi.fn() } });
    open();
    expect(items()).toEqual(['Anheften', 'Bearbeiten', 'Löschen']);
  });

  it('the pinned message offers to unpin, and choosing it reports once and closes the menu', () => {
    const onToggle = vi.fn();
    menu({ pin: { pinned: true, onToggle } });
    open();
    expect(items()).toEqual(['Anheftung aufheben']);
    click(container.querySelector('[role="menuitem"]'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it('while a pin request is running the item cannot be tapped again', () => {
    const onToggle = vi.fn();
    menu({ pin: { pinned: false, busy: true, onToggle } });
    open();
    expect((container.querySelector('[role="menuitem"]') as HTMLButtonElement).disabled).toBe(true);
  });
});
