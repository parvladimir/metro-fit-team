'use client';

import { Bookmark, CheckCircle2, ChevronRight, Dumbbell, Eye, MoreHorizontal, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { shareExerciseSummary, shareKindLabel, formatActualSummary } from '@/lib/plan-shares';
import type { PlanShareForViewer } from '@/lib/data/plan-shares';

/** Structured, immutable card for a shared template/day/workout inside chat. */
export function SharedPlanCard({
  share,
  isAuthor,
  onView,
  onSave,
  onWithdraw,
}: {
  share: PlanShareForViewer;
  isAuthor: boolean;
  onView: () => void;
  onSave: () => void;
  onWithdraw?: () => void;
}) {
  const summary = shareExerciseSummary(share.items);
  const actualSummary = formatActualSummary(share.actual_duration_seconds, share.actual_distance_km);
  const Icon = share.source_type === 'workout' ? CheckCircle2 : Dumbbell;

  return (
    <div className="w-[min(84vw,340px)] rounded-2xl border border-white/[0.08] bg-surface-2 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-brand">
          <Icon size={13} strokeWidth={2.2} />
          {share.authorName} hat {share.source_type === 'workout' ? 'ein abgeschlossenes Training' : 'eine Trainingsvorlage'} geteilt
        </p>
        {isAuthor && onWithdraw && !share.withdrawn_at && <ShareCardMenu onWithdraw={onWithdraw} />}
      </div>

      {share.withdrawn_at ? (
        <p className="mt-2 text-sm text-neutral-500">Freigabe wurde zurückgezogen.</p>
      ) : (
        <>
          <p className="mt-2 text-base font-bold text-neutral-900">{share.title}</p>
          <p className="text-xs text-neutral-500">
            {shareKindLabel(share.source_type)} · {share.items.length} {share.items.length === 1 ? 'Übung' : 'Übungen'}
          </p>
          {summary && <p className="mt-1.5 break-words text-sm text-neutral-400">{summary}</p>}
          {actualSummary && <p className="mt-1 text-xs font-semibold text-brand">{actualSummary}</p>}

          <div className="mt-3 flex gap-2">
            <button type="button" onClick={onView} className="btn-secondary !min-h-[38px] flex-1 !px-3 text-xs">
              <Eye size={15} strokeWidth={2} />
              Ansehen
            </button>
            <button
              type="button"
              onClick={onSave}
              className="btn-secondary !min-h-[38px] flex-1 !px-3 text-xs"
              style={share.savedTemplateId ? undefined : { color: 'rgb(var(--accent-primary-rgb))' }}
            >
              {share.savedTemplateId ? (
                <>
                  <ChevronRight size={15} strokeWidth={2} />
                  Bereits gespeichert
                </>
              ) : (
                <>
                  <Bookmark size={15} strokeWidth={2} />
                  Als Vorlage speichern
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ShareCardMenu({ onWithdraw }: { onWithdraw: () => void }) {
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
    <div ref={ref} className="relative shrink-0">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label="Freigabe-Optionen" className="flex h-6 w-6 items-center justify-center rounded-full text-neutral-400">
        <MoreHorizontal size={15} strokeWidth={2.25} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-7 z-20 flex min-w-[13rem] flex-col rounded-xl border border-white/10 bg-neutral-150 p-1 shadow-xl">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              if (!confirming) return setConfirming(true);
              setOpen(false);
              setConfirming(false);
              onWithdraw();
            }}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-red-400 active:bg-red-500/10"
          >
            <Undo2 size={14} /> {confirming ? 'Wirklich zurückziehen?' : 'Freigabe zurückziehen'}
          </button>
        </div>
      )}
    </div>
  );
}
