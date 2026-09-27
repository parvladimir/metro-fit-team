'use client';

import { useEffect, useRef, useState } from 'react';
import { QUICK_REACTIONS, REACTIONS, type ReactionKey } from '@/lib/reactions';

/** Bottom sheet reaction picker: the 6 quick reactions, with a "Weitere"
 * control expanding the same sheet to all 20 in a grid. Every emoji is an
 * independent toggle — a user can hold several active on the same message at
 * once, so tapping one only ever flips that one, never clearing the others.
 * Mirrors `WorkoutActionsMenu`'s exact bottom-sheet shape (this codebase has
 * no anchored/repositioning popover anywhere, so this is used at every
 * viewport size rather than inventing one). No internal `position: sticky` —
 * nothing here needs to stay pinned while something else scrolls. */
export function ReactionPicker({
  active,
  onToggle,
  onClose,
}: {
  /** every key the viewer currently has active on this message */
  active: ReactionKey[];
  onToggle: (key: ReactionKey, active: boolean) => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sheetRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function pick(key: ReactionKey) {
    onToggle(key, !active.includes(key));
    onClose();
  }

  const list = expanded ? REACTIONS : REACTIONS.filter((r) => QUICK_REACTIONS.includes(r.key));

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose} role="dialog" aria-modal="true" aria-label="Reagieren">
      <div
        ref={sheetRef}
        tabIndex={-1}
        className="mx-auto w-full max-w-app rounded-t-3xl border-t border-white/10 bg-neutral-100 p-4 outline-none"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300" />
        <p className="mb-2.5 text-center text-[11px] font-medium text-neutral-500">Mehrere Reaktionen möglich</p>
        <div className={`grid justify-items-center gap-2 ${expanded ? 'grid-cols-5' : 'grid-cols-6'}`}>
          {list.map((r) => {
            const isActive = active.includes(r.key);
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => pick(r.key)}
                aria-pressed={isActive}
                aria-label={r.label}
                title={r.label}
                className={`group relative flex h-11 w-11 items-center justify-center rounded-2xl text-2xl transition active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                  isActive ? 'bg-brand/15 ring-1 ring-brand/40' : 'bg-surface-3'
                }`}
              >
                <span aria-hidden>{r.emoji}</span>
                <span className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-neutral-900 px-2 py-1 text-[11px] font-medium text-white group-hover:block group-focus-visible:block">
                  {r.label}
                </span>
              </button>
            );
          })}
        </div>
        {!expanded && (
          <button type="button" onClick={() => setExpanded(true)} className="btn-ghost mt-3 w-full !min-h-[36px] text-xs">
            Weitere
          </button>
        )}
        <button type="button" onClick={onClose} className="btn-secondary mt-2 w-full">
          Abbrechen
        </button>
      </div>
    </div>
  );
}
