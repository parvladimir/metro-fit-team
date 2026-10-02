'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A bottom sheet in the app's usual look (dark panel, drag handle, safe-area aware).
 *
 * Unlike the older hand-rolled sheets it also behaves like a real dialog: Escape closes
 * it, Tab stays inside it, the page behind does not scroll, and focus returns to the
 * control that opened it.
 */
export function Sheet({
  title,
  onClose,
  children,
  closeLabel = 'Schließen',
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  closeLabel?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus({ preventScroll: true });

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="mx-auto flex max-h-[85dvh] w-full max-w-app flex-col overflow-hidden rounded-t-3xl border-t border-white/10 bg-surface-2 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-3">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300" />
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="min-w-0 break-words text-lg font-bold text-neutral-900">{title}</h2>
            <button type="button" onClick={onClose} aria-label={closeLabel} className="btn-icon h-11 w-11 shrink-0">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
