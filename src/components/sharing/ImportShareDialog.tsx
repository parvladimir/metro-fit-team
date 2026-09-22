'use client';

import { useState, useTransition } from 'react';
import { Bookmark, Check, X } from 'lucide-react';
import { importShareAction } from '@/app/(app)/team/chat/share-actions';
import { SHARE_TITLE_MAX_LENGTH } from '@/lib/plan-shares';
import type { PlanShareForViewer } from '@/lib/data/plan-shares';

/** "Als Vorlage speichern" for a share: name + optional "keep the shared
 * weights" choice, with idempotent-save awareness ("Bereits gespeichert"). */
export function ImportShareDialog({
  share,
  onClose,
  onSaved,
}: {
  share: PlanShareForViewer;
  onClose: () => void;
  onSaved: (templateId: string) => void;
}) {
  const [name, setName] = useState(share.title);
  const [keepWeights, setKeepWeights] = useState(false);
  const [forceNewCopy, setForceNewCopy] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [alreadyImported, setAlreadyImported] = useState(!!share.savedTemplateId && !forceNewCopy);

  function submit() {
    setError(null);
    start(async () => {
      const result = await importShareAction(share.id, name, keepWeights, forceNewCopy);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.alreadyImported && !forceNewCopy) {
        setAlreadyImported(true);
        onSaved(result.templateId);
        return;
      }
      onSaved(result.templateId);
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5" role="dialog" aria-modal="true" aria-labelledby="import-share-title">
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-neutral-100 p-5">
        <div className="flex items-start justify-between gap-3">
          <span className="icon-chip accent-primary h-11 w-11 shrink-0">
            <Bookmark size={20} strokeWidth={2.2} />
          </span>
          <button type="button" onClick={onClose} aria-label="Schließen" className="btn-icon">
            <X size={18} />
          </button>
        </div>
        <h2 id="import-share-title" className="mt-3 text-lg font-bold text-neutral-900">Als Vorlage speichern</h2>

        {alreadyImported ? (
          <>
            <p className="mt-1.5 text-sm text-neutral-500">Du hast diese Vorlage bereits gespeichert.</p>
            <div className="mt-5 flex flex-col gap-2">
              <button type="button" onClick={onClose} className="btn-primary">Meine Vorlage öffnen</button>
              <button
                type="button"
                onClick={() => {
                  setForceNewCopy(true);
                  setAlreadyImported(false);
                }}
                className="btn-secondary"
              >
                Weitere Kopie erstellen
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1.5 text-sm text-neutral-500">Das erstellt eine unabhängige, eigene Kopie in „Meine Vorlagen“.</p>
            <div className="mt-4">
              <label className="label" htmlFor="import-share-name">Name der Vorlage</label>
              <input
                id="import-share-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={SHARE_TITLE_MAX_LENGTH}
                autoFocus
                className="input-field w-full"
              />
            </div>
            {share.share_weights && (
              <label className="mt-3 flex items-center gap-2 text-sm font-medium text-neutral-700">
                <input type="checkbox" checked={keepWeights} onChange={(e) => setKeepWeights(e.target.checked)} className="h-5 w-5 accent-brand" />
                Geplante Gewichte übernehmen
              </label>
            )}
            {error && <p className="mt-2 text-sm font-medium text-red-400">{error}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" disabled={pending} onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
              <button type="button" disabled={pending} onClick={submit} className="btn-primary flex-1">
                {pending ? 'Wird gespeichert…' : (
                  <>
                    <Check size={16} strokeWidth={2.5} /> Speichern
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
