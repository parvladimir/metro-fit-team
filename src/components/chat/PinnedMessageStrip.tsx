'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, Image as ImageIcon, Pin, PinOff } from 'lucide-react';
import type { PinnedMessage } from '@/lib/chat-pin';

const COLLAPSED_KEY = (teamId: string) => `mft:chat-pin-collapsed:${teamId}`;

/**
 * The one pinned message of the team chat, as a compact strip below the header: "Angeheftete Nachricht", the
 * author and two lines of the ORIGINAL message, and "Ansehen" which scrolls to it. Each viewer can fold it into
 * a single row (remembered on this device). It adds no scroll area of its own and never takes half the screen.
 */
export function PinnedMessageStrip({
  teamId,
  pin,
  canManage,
  busy,
  onView,
  onUnpin,
}: {
  teamId: string;
  pin: PinnedMessage;
  canManage: boolean;
  busy: boolean;
  onView: () => void;
  onUnpin: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  // Restore this viewer's choice after mount (never during render: the server cannot know it).
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSED_KEY(teamId)) === '1');
    } catch {
      /* storage unavailable: the strip simply starts open */
    }
  }, [teamId]);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSED_KEY(teamId), next ? '1' : '0');
      } catch {
        /* nothing to remember it with */
      }
      return next;
    });
  }

  return (
    <section aria-label="Angeheftete Nachricht" className="shrink-0 border-b border-brand/25 bg-surface-2 px-4 py-1.5">
      <div className="flex items-center gap-2">
        <Pin size={15} strokeWidth={2.1} className="shrink-0 text-brand" aria-hidden="true" />
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Angeheftete Nachricht aufklappen' : 'Angeheftete Nachricht einklappen'}
          className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-brand">Angeheftete Nachricht</span>
            {!collapsed && (
              <span className="mt-0.5 line-clamp-2 break-words text-sm text-neutral-700">
                <span className="font-semibold text-neutral-900">{pin.authorName}: </span>
                {pin.isImage && (
                  <span className="inline-flex items-center gap-1 text-neutral-500">
                    <ImageIcon size={13} aria-hidden="true" /> Foto{pin.preview ? ' · ' : ''}
                  </span>
                )}
                {pin.preview}
              </span>
            )}
          </span>
          <ChevronDown size={16} className={`shrink-0 text-neutral-400 transition ${collapsed ? '' : 'rotate-180'}`} aria-hidden="true" />
        </button>
        <button type="button" onClick={onView} className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg px-2 text-xs font-bold text-brand active:bg-brand/10">
          Ansehen
        </button>
      </div>
      {canManage && !collapsed && (
        <div className="-mt-1 flex justify-end">
          <button type="button" onClick={onUnpin} disabled={busy} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-neutral-500 active:bg-neutral-150 disabled:opacity-50">
            <PinOff size={14} aria-hidden="true" /> Anheftung aufheben
          </button>
        </div>
      )}
    </section>
  );
}
