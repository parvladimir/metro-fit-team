'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { CheckCircle2, Dumbbell, Send, X } from 'lucide-react';
import { sharePlanAction, type SharePlanInput } from '@/app/(app)/team/chat/share-actions';
import { SHARE_NOTE_MAX_LENGTH, SHARE_TITLE_MAX_LENGTH } from '@/lib/plan-shares';
import type { ChatMessage } from '@/lib/data/chat';
import type { PlanShareWithItems } from '@/lib/data/plan-shares';

export interface SharePreviewItem {
  name: string;
  hasWeight: boolean;
  hasInstructions: boolean;
}

export interface SharePreviewSource {
  sourceType: 'template' | 'workout';
  sourceTemplateId?: string;
  sourcePlanDayId?: string;
  sourceWorkoutId?: string;
  defaultTitle: string;
  items: SharePreviewItem[];
  /** Only meaningful for a completed workout. */
  supportsActualSummary?: boolean;
}

/** "Im Team-Chat teilen" preview, shared by every entry point (Meine
 * Vorlagen, a configured Plan day, a completed workout, and the chat
 * composer's own template picker). */
export function SharePreviewSheet({
  teamId,
  source,
  onClose,
  onShared,
}: {
  teamId: string;
  source: SharePreviewSource;
  onClose: () => void;
  /** When given (sharing FROM the chat page itself), the new card is added
   * to the local message list immediately and the sheet just closes — the
   * chat is already the destination, so no separate confirmation is shown.
   * When omitted, a generic success screen with a link to the chat is shown. */
  onShared?: (message: ChatMessage, share: PlanShareWithItems) => void;
}) {
  const [title, setTitle] = useState(source.defaultTitle);
  const [note, setNote] = useState('');
  const [shareWeights, setShareWeights] = useState(false);
  const [shareInstructions, setShareInstructions] = useState(false);
  const [shareActualSummary, setShareActualSummary] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const hasWeights = source.items.some((i) => i.hasWeight);
  const hasInstructions = source.items.some((i) => i.hasInstructions);
  const preview = source.items.slice(0, 3).map((i) => i.name);
  const extra = source.items.length - preview.length;

  function submit() {
    setError(null);
    const input: SharePlanInput = {
      teamId,
      sourceType: source.sourceType,
      sourceTemplateId: source.sourceTemplateId,
      sourcePlanDayId: source.sourcePlanDayId,
      sourceWorkoutId: source.sourceWorkoutId,
      title,
      note,
      shareWeights,
      shareInstructions,
      shareActualSummary,
    };
    start(async () => {
      const result = await sharePlanAction(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (onShared) {
        onShared(result.message, result.share);
        onClose();
      } else {
        setSent(true);
      }
    });
  }

  if (sent) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5" role="dialog" aria-modal="true">
        <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-neutral-100 p-5 text-center">
          <span className="icon-chip accent-success mx-auto flex h-12 w-12 items-center justify-center">
            <CheckCircle2 size={22} strokeWidth={2.1} />
          </span>
          <h2 className="mt-3 text-lg font-bold text-neutral-900">Im Team-Chat geteilt</h2>
          <p className="mt-1.5 text-sm text-neutral-500">Dein Team kann die Vorlage jetzt ansehen und speichern.</p>
          <div className="mt-5 flex flex-col gap-2">
            <Link href="/team/chat" className="btn-primary">Zum Team-Chat</Link>
            <button type="button" onClick={onClose} className="btn-secondary">Schließen</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose} role="dialog" aria-modal="true" aria-label="Im Team-Chat teilen">
      <div
        className="mx-auto max-h-[88dvh] w-full max-w-app overflow-y-auto rounded-t-3xl border-t border-white/10 bg-surface-2 p-4"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300" />
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-neutral-900">Im Team-Chat teilen</h2>
          <button type="button" onClick={onClose} aria-label="Schließen" className="btn-icon">
            <X size={18} />
          </button>
        </div>

        <div className="card-quiet flex items-start gap-3 !py-3">
          <span className="icon-chip accent-primary h-10 w-10 shrink-0">
            {source.sourceType === 'workout' ? <CheckCircle2 size={18} strokeWidth={2.1} /> : <Dumbbell size={18} strokeWidth={2.1} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-neutral-900">{title || source.defaultTitle}</p>
            <p className="text-xs text-neutral-500">{source.items.length} {source.items.length === 1 ? 'Übung' : 'Übungen'}</p>
            {preview.length > 0 && (
              <p className="mt-1 break-words text-xs text-neutral-400">
                {preview.join(' · ')}
                {extra > 0 ? ` · +${extra} weitere Übungen` : ''}
              </p>
            )}
          </div>
        </div>

        <div className="mt-3">
          <label className="label" htmlFor="share-title">Titel</label>
          <input id="share-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={SHARE_TITLE_MAX_LENGTH} className="input-field w-full" />
        </div>

        <div className="mt-3">
          <label className="label" htmlFor="share-note">Nachricht (optional)</label>
          <textarea
            id="share-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={SHARE_NOTE_MAX_LENGTH}
            rows={2}
            placeholder="z. B. „Das ist mein aktueller Push-Plan.“"
            className="input-field w-full resize-none"
          />
        </div>

        <div className="mt-3 flex flex-col gap-2">
          {hasWeights && (
            <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
              <input type="checkbox" checked={shareWeights} onChange={(e) => setShareWeights(e.target.checked)} className="h-5 w-5 accent-brand" />
              Geplante Gewichte mit teilen
            </label>
          )}
          {hasInstructions && (
            <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
              <input type="checkbox" checked={shareInstructions} onChange={(e) => setShareInstructions(e.target.checked)} className="h-5 w-5 accent-brand" />
              Übungshinweise mit teilen
            </label>
          )}
          {source.supportsActualSummary && (
            <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
              <input type="checkbox" checked={shareActualSummary} onChange={(e) => setShareActualSummary(e.target.checked)} className="h-5 w-5 accent-brand" />
              Dauer &amp; Distanz mit teilen
            </label>
          )}
        </div>

        {error && <p className="mt-2 text-sm font-medium text-red-400">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button type="button" disabled={pending} onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
          <button type="button" disabled={pending || !title.trim()} onClick={submit} className="btn-primary flex-1">
            {pending ? 'Wird geteilt…' : (
              <>
                <Send size={16} strokeWidth={2.1} /> Teilen
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
