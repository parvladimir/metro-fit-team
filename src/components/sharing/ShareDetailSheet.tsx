'use client';

import { useState } from 'react';
import { Bookmark, CheckCircle2, Dumbbell, Info, X } from 'lucide-react';
import { exerciseTypeLabel, muscleGroupLabel } from '@/lib/exercise-types';
import { formatTargets, targetsFromRow } from '@/lib/plan-targets';
import { shareKindLabel, formatActualSummary } from '@/lib/plan-shares';
import { ImportShareDialog } from '@/components/sharing/ImportShareDialog';
import type { PlanShareForViewer } from '@/lib/data/plan-shares';

/** "Ansehen" — the full read-only detail view of a shared template/workout. */
export function ShareDetailSheet({ share, onClose }: { share: PlanShareForViewer; onClose: () => void }) {
  const [importing, setImporting] = useState(false);
  const [savedTemplateId, setSavedTemplateId] = useState(share.savedTemplateId);
  const actualSummary = formatActualSummary(share.actual_duration_seconds, share.actual_distance_km);
  const hasAnyTargets = share.items.some((i) => formatTargets(i.exercise_type, targetsFromRow(i.exercise_type, i)));
  const Icon = share.source_type === 'workout' ? CheckCircle2 : Dumbbell;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose} role="dialog" aria-modal="true" aria-label={share.title}>
        <div
          className="mx-auto max-h-[88dvh] w-full max-w-app overflow-y-auto rounded-t-3xl border-t border-white/10 bg-surface-2 p-4"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300" />
          <div className="mb-1 flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="icon-chip accent-primary h-10 w-10">
                <Icon size={18} strokeWidth={2.1} />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold text-neutral-900">{share.title}</h2>
                <p className="text-xs text-neutral-500">{shareKindLabel(share.source_type)} · von {share.authorName}</p>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Schließen" className="btn-icon">
              <X size={18} />
            </button>
          </div>

          {actualSummary && <p className="mb-2 text-sm font-semibold text-brand">{actualSummary}</p>}

          <div className="mt-2 flex flex-col gap-2">
            {share.items.map((item, i) => {
              const summary = formatTargets(item.exercise_type, targetsFromRow(item.exercise_type, item));
              return (
                <div key={item.id} className="card-quiet flex items-start gap-3 !py-3">
                  <span className="mt-0.5 shrink-0 text-xs font-bold text-neutral-500">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-semibold text-neutral-900">{item.exercise_name}</p>
                    <p className="break-words text-xs text-neutral-500">
                      {exerciseTypeLabel(item.exercise_type)} · {muscleGroupLabel(item.muscle_group)}
                      {item.equipment ? ` · ${item.equipment}` : ''}
                    </p>
                    {summary && <p className="mt-1 text-sm font-semibold text-brand">{summary}</p>}
                    {item.instructions && <p className="mt-1 break-words text-xs text-neutral-500">{item.instructions}</p>}
                  </div>
                </div>
              );
            })}
          </div>

          {hasAnyTargets && !share.withdrawn_at && (
            <p className="mt-3 flex items-start gap-2 text-xs text-neutral-500">
              <Info size={14} className="mt-0.5 shrink-0" />
              Passe die Ziele und Gewichte an dein eigenes Training an.
            </p>
          )}

          {!share.withdrawn_at && (
            <button type="button" onClick={() => setImporting(true)} className="btn-primary mt-4 w-full">
              <Bookmark size={17} strokeWidth={2.1} />
              {savedTemplateId ? 'Bereits gespeichert' : 'Als Vorlage speichern'}
            </button>
          )}
        </div>
      </div>

      {importing && (
        <ImportShareDialog
          share={{ ...share, savedTemplateId }}
          onClose={() => setImporting(false)}
          onSaved={(templateId) => setSavedTemplateId(templateId)}
        />
      )}
    </>
  );
}
