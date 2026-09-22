'use client';

import { useEffect, useState, useTransition } from 'react';
import { Bookmark, Check, X } from 'lucide-react';
import { saveAsTemplateAction } from '@/app/(app)/plan/actions';
import { TEMPLATE_NAME_MAX_LENGTH } from '@/lib/plan-templates';

/** "Als Vorlage speichern" for the current weekday's exercises, with a name
 * prompt and a brief "Vorlage gespeichert" confirmation. */
export function SaveAsTemplateButton({ weekday, suggestedName }: { weekday: number; suggestedName: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(suggestedName);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(timer);
  }, [saved]);

  function submit() {
    setError(null);
    start(async () => {
      const result = await saveAsTemplateAction(weekday, name);
      if (!result.ok) {
        setError(result.error ?? 'Vorlage konnte nicht gespeichert werden.');
        return;
      }
      setOpen(false);
      setSaved(true);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setName(suggestedName);
          setError(null);
          setOpen(true);
        }}
        className="btn-ghost self-start bg-neutral-150 px-4 text-sm text-brand"
      >
        <Bookmark size={16} strokeWidth={2} />
        Als Vorlage speichern
      </button>

      {saved && (
        <p className="flex items-center gap-2 text-sm font-semibold text-accent-success" role="status">
          <Check size={16} strokeWidth={2.5} />
          Vorlage gespeichert
        </p>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5" role="dialog" aria-modal="true" aria-labelledby="save-template-title">
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-neutral-100 p-5">
            <div className="flex items-start justify-between gap-3">
              <span className="icon-chip accent-primary h-11 w-11 shrink-0">
                <Bookmark size={20} strokeWidth={2.2} />
              </span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Schließen" className="btn-icon">
                <X size={18} />
              </button>
            </div>
            <h2 id="save-template-title" className="mt-3 text-lg font-bold text-neutral-900">Als Vorlage speichern</h2>
            <p className="mt-1.5 text-sm text-neutral-500">
              Speichere die Übungen dieses Tages, um sie später für einen anderen Tag wiederzuverwenden.
            </p>
            <div className="mt-4">
              <label className="label" htmlFor="template-name">Name der Vorlage</label>
              <input
                id="template-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={TEMPLATE_NAME_MAX_LENGTH}
                placeholder="z. B. Brust & Trizeps"
                autoFocus
                className="input-field w-full"
              />
            </div>
            {error && <p className="mt-2 text-sm font-medium text-red-400">{error}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" disabled={pending} onClick={() => setOpen(false)} className="btn-secondary flex-1">
                Abbrechen
              </button>
              <button type="button" disabled={pending} onClick={submit} className="btn-primary flex-1">
                {pending ? 'Wird gespeichert…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
