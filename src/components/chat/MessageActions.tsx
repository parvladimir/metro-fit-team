'use client';

import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

/** Small "⋯" menu for the sender's own human messages: Bearbeiten / Löschen. */
export function MessageActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
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
        </div>
      )}
    </div>
  );
}
