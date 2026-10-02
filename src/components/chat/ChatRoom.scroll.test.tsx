// @vitest-environment jsdom
// How the chat follows (or leaves alone) a reader. The message list is the page's only scroller (see .app-shell in
// globals.css); jsdom has no layout, so its scroll metrics are faked here. That the list really is the scroller at
// phone widths is checked in a real browser, not in this file.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// React 18's react-dom has no useFormStatus (Next bundles a React that does); the send button only needs "not pending".
vi.mock('react-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-dom')>()), useFormStatus: () => ({ pending: false }) }));

const sendMessageAction = vi.fn();
const loadOlderMessagesAction = vi.fn();
vi.mock('@/app/(app)/team/chat/actions', () => ({
  sendMessageAction: (...a: unknown[]) => sendMessageAction(...a),
  loadOlderMessagesAction: (...a: unknown[]) => loadOlderMessagesAction(...a),
  loadMessagesUntilAction: vi.fn(),
  sendImageMessageAction: vi.fn(),
  markChatReadAction: () => Promise.resolve(),
  markNotificationsReadAction: () => Promise.resolve(),
  editMessageAction: vi.fn(),
  deleteMessageAction: vi.fn(),
  setReactionAction: vi.fn(),
  sendEventReplyAction: vi.fn(),
  savePushSubscriptionAction: vi.fn(),
  getMessageReactorsAction: vi.fn(),
}));
vi.mock('@/app/(app)/team/chat/pin-actions', () => ({ pinMessageAction: vi.fn(), unpinMessageAction: vi.fn() }));
vi.mock('@/app/(app)/team/chat/share-actions', () => ({ withdrawShareAction: vi.fn(), importShareAction: vi.fn(), sharePlanAction: vi.fn() }));
vi.mock('@/app/(app)/team/training/actions', () => ({ cancelTrainingInviteAction: vi.fn(), setRsvpAction: vi.fn() }));
vi.mock('@/lib/unread-store', () => ({ refreshUnread: () => Promise.resolve() }));
vi.mock('@/lib/notification-store', () => ({ refreshNotificationCount: () => Promise.resolve() }));

// A Supabase client that records the realtime handlers (so a test can deliver a message) and answers every lookup empty.
type RealtimeHandler = (payload: { new?: unknown; old?: unknown }) => unknown;
const realtime: { table: string; event: string; fn: RealtimeHandler }[] = [];
function lookup() {
  const q: Record<string, unknown> = {
    select: () => q,
    eq: () => q,
    in: () => q,
    maybeSingle: () => Promise.resolve({ data: { full_name: 'Tim', avatar_url: null } }),
    then: (resolve: (v: { data: unknown[] }) => unknown) => Promise.resolve({ data: [] }).then(resolve),
  };
  return q;
}
const fakeClient = {
  auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  realtime: { setAuth: () => undefined },
  channel: () => {
    const channel = {
      on: (_type: string, filter: { event: string; table: string }, fn: RealtimeHandler) => {
        realtime.push({ table: filter.table, event: filter.event, fn });
        return channel;
      },
      subscribe: () => channel,
    };
    return channel;
  },
  removeChannel: () => undefined,
  from: () => lookup(),
  storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: null }) }) },
};
vi.mock('@/lib/supabase/client', () => ({ createClient: () => fakeClient }));

import { ChatRoom } from '@/components/chat/ChatRoom';
import type { ChatMessage } from '@/lib/data/chat';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ME = 'user-me';
const msg = (i: number, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `m-${i}`,
  team_id: 'team-1',
  user_id: i % 2 ? 'user-tim' : ME,
  reply_to_id: null,
  parent_message_id: null,
  content: `Nachricht ${i}`,
  message_type: 'text',
  attachment_path: null,
  attachment_mime: null,
  attachment_width: null,
  attachment_height: null,
  event_type: null,
  metadata: {},
  workout_id: null,
  created_at: new Date(Date.UTC(2026, 9, 1, 8, i)).toISOString(),
  edited_at: null,
  deleted_at: null,
  authorName: i % 2 ? 'Tim' : 'Ich',
  authorAvatar: null,
  creatorName: null,
  ...over,
});

let container: HTMLDivElement;
let root: Root;
const scrollIntoView = vi.fn();
const resizeCallbacks: (() => void)[] = [];

beforeEach(() => {
  realtime.length = 0;
  resizeCallbacks.length = 0;
  scrollIntoView.mockClear();
  sendMessageAction.mockReset();
  loadOlderMessagesAction.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView; // not implemented by jsdom
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        resizeCallbacks.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // React 18 does not know a function-valued form `action` (Next's React does); the test calls it directly.
  const original = console.error;
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('Invalid value for prop') && String(args[1]).includes('action')) return;
    original(...args);
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount(over: { count?: number; hasMore?: boolean } = {}) {
  await act(async () => {
    root.render(
      <ChatRoom
        teamId="team-1"
        currentUserId={ME}
        initialMessages={Array.from({ length: over.count ?? 40 }, (_, i) => msg(i + 1))}
        previousReadAt={null}
        initialSocial={{}}
        initialReactions={{}}
        focusMessageId={null}
        members={[]}
        initialMentions={{}}
        initialHasMore={over.hasMore ?? false}
        initialQuotes={{}}
        initialShares={{}}
        initialInvites={{}}
        myTemplates={[]}
        isTeamAdmin={false}
        initialPin={null}
        pinAvailable={false}
      />,
    );
  });
  await act(async () => {}); // the realtime handlers are registered once the session has resolved
  scrollIntoView.mockClear(); // the initial jump to the newest message is not what these tests are about
}

/** The message list: jsdom has no layout, so give it a scroll height (100 px per message) and a viewport. */
function scroller(clientHeight = 600) {
  const list = container.querySelector('[id^="msg-"]')!.parentElement as HTMLElement;
  const state = { scrollTop: 0, assigned: [] as number[] };
  Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => clientHeight });
  Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => list.querySelectorAll('[id^="msg-"]').length * 100 });
  Object.defineProperty(list, 'scrollTop', {
    configurable: true,
    get: () => state.scrollTop,
    set: (v: number) => {
      state.scrollTop = v;
      state.assigned.push(v);
    },
  });
  /** The reader scrolls to `top` (a scroll event, like the browser's). */
  const scrollTo = (top: number) => {
    state.scrollTop = top;
    act(() => {
      list.dispatchEvent(new Event('scroll'));
    });
  };
  return { list, state, scrollTo, bottom: () => list.querySelectorAll('[id^="msg-"]').length * 100 - clientHeight };
}

async function deliver(row: ChatMessage) {
  const handler = realtime.find((h) => h.table === 'messages' && h.event === 'INSERT')!.fn;
  await act(async () => {
    await handler({ new: row });
  });
}

describe('a new message from someone else', () => {
  it('is followed while the reader is at the bottom', async () => {
    await mount();
    const s = scroller();
    s.scrollTo(s.bottom() - 10);
    await deliver(msg(101, { user_id: 'user-tim' }));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' });
  });

  it('leaves a reader who scrolled up to read where they are', async () => {
    await mount();
    const s = scroller();
    s.scrollTo(500);
    await deliver(msg(101, { user_id: 'user-tim' }));
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Nachricht 101'); // it is there, just not forced on them
  });
});

describe('the reader\'s own message', () => {
  it('comes into view even after scrolling up (a photo arrives through realtime like any other message)', async () => {
    await mount();
    const s = scroller();
    s.scrollTo(500);
    await deliver(msg(101, { user_id: ME, message_type: 'image', attachment_path: 'p.jpg', content: '' }));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' });
  });

  it('comes into view after sending text from the composer, even after scrolling up', async () => {
    await mount();
    const s = scroller();
    s.scrollTo(500);
    sendMessageAction.mockResolvedValue({ ok: true, message: msg(102, { user_id: ME, content: 'Bin dabei' }), mentions: [] });
    const form = container.querySelector('form') as HTMLFormElement;
    const propsKey = Object.keys(form).find((k) => k.startsWith('__reactProps$'))!;
    const action = (form as unknown as Record<string, { action: (data: FormData) => Promise<void> }>)[propsKey]!.action;
    await act(async () => {
      await action(new FormData(form));
    });
    expect(container.textContent).toContain('Bin dabei');
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' });
  });

  it('an automatic event written on the reader\'s behalf does not pull them down', async () => {
    await mount();
    const s = scroller();
    s.scrollTo(500);
    await deliver(msg(103, { user_id: ME, message_type: 'system', content: 'Training beendet' }));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('"Ältere Nachrichten laden"', () => {
  it('keeps the reader\'s place and does not jump to the bottom', async () => {
    await mount({ hasMore: true });
    const s = scroller();
    s.scrollTo(300); // reading near the top of what is loaded
    const older = Array.from({ length: 10 }, (_, i) => msg(-i, { id: `old-${i}`, created_at: new Date(Date.UTC(2026, 8, 1, 8, i)).toISOString() }));
    loadOlderMessagesAction.mockResolvedValue({ messages: older, hasMore: false, mentions: {}, social: {}, reactions: {}, quotes: {}, shares: {}, invites: {} });
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Ältere Nachrichten laden'))!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // ten messages (1000 px) were added above: the same messages stay under the reader's thumb
    expect(s.state.scrollTop).toBe(300 + 10 * 100);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('when the list is resized (the composer grows, a keyboard changes the viewport)', () => {
  it('a reader at the bottom stays at the bottom', async () => {
    await mount();
    const s = scroller();
    s.scrollTo(s.bottom());
    s.state.assigned.length = 0;
    act(() => resizeCallbacks.forEach((cb) => cb()));
    expect(s.state.assigned).toEqual([40 * 100]);
  });

  it('a reader who scrolled up is not moved', async () => {
    await mount();
    const s = scroller();
    s.scrollTo(500);
    s.state.assigned.length = 0;
    act(() => resizeCallbacks.forEach((cb) => cb()));
    expect(s.state.assigned).toEqual([]);
  });
});
