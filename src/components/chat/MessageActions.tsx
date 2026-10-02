'use client';

import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';

/** Small "⋯" menu of a message: the sender's own human messages get Bearbeiten / Löschen, and a team admin
 * additionally gets Anheften / Anheftung aufheben on any pinnable message. Renders nothing when there is
 * nothing to offer. Who may pin is decided by the database — this only decides what is shown. */
export function MessageActions({
  onEdit,
  onDelete,
  pin,
}: {
  onEdit?: () => void;
  onDelete?: () => void;
  /** Present for team admins only. */
  pin?: { pinned: boolean; busy?: boolean; onToggle: () => void };
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setConfirming(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!onEdit && !onDelete && !pin) return null;

  return (
    <div ref={ref} className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Nachrichtenoptionen"
        aria-expanded={open}
        className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 transition active:bg-neutral-150"
      >
        <MoreHorizontal size={16} strokeWidth={2.25} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-8 z-20 flex min-w-[9rem] flex-col rounded-xl border border-white/10 bg-neutral-150 p-1 shadow-xl">
          {pin && (
            <button
              type="button"
              role="menuitem"
              disabled={pin.busy}
              onClick={() => {
                setOpen(false);
                pin.onToggle();
              }}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-neutral-900 active:bg-neutral-200 disabled:opacity-50"
            >
              {pin.pinned ? <PinOff size={14} /> : <Pin size={14} />} {pin.pinned ? 'Anheftung aufheben' : 'Anheften'}
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-neutral-900 active:bg-neutral-200"
            >
              <Pencil size={14} /> Bearbeiten
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                if (!confirming) return setConfirming(true);
                setOpen(false);
                setConfirming(false);
                onDelete();
              }}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-red-400 active:bg-red-500/10"
            >
              <Trash2 size={14} /> {confirming ? 'Wirklich löschen?' : 'Löschen'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
