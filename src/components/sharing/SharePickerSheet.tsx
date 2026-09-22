'use client';

import { useState } from 'react';
import { ChevronRight, Layers, X } from 'lucide-react';
import { SharePreviewSheet, type SharePreviewSource } from '@/components/sharing/SharePreviewSheet';
import { templateExerciseSummary } from '@/lib/plan-templates';
import type { PlanTemplateWithItems } from '@/lib/data/plan-templates';
import type { ChatMessage } from '@/lib/data/chat';
import type { PlanShareWithItems } from '@/lib/data/plan-shares';

/** "Vorlage teilen" from the chat composer: pick one of the sender's own
 * templates, then reuse the normal preview-before-sending sheet. */
export function SharePickerSheet({
  teamId,
  templates,
  onClose,
  onShared,
}: {
  teamId: string;
  templates: PlanTemplateWithItems[];
  onClose: () => void;
  onShared: (message: ChatMessage, share: PlanShareWithItems) => void;
}) {
  const [selected, setSelected] = useState<PlanTemplateWithItems | null>(null);

  if (selected) {
    const source: SharePreviewSource = {
      sourceType: 'template',
      sourceTemplateId: selected.id,
      defaultTitle: selected.name,
      items: selected.items.map((i) => ({ name: i.exercise_name, hasWeight: i.target_weight_kg != null, hasInstructions: !!i.exercise?.instructions })),
    };
    return <SharePreviewSheet teamId={teamId} source={source} onClose={onClose} onShared={onShared} />;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose} role="dialog" aria-modal="true" aria-label="Vorlage teilen">
      <div
        className="mx-auto max-h-[75dvh] w-full max-w-app overflow-y-auto rounded-t-3xl border-t border-white/10 bg-surface-2 p-4"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300" />
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-neutral-900">Vorlage teilen</h2>
          <button type="button" onClick={onClose} aria-label="Schließen" className="btn-icon">
            <X size={18} />
          </button>
        </div>

        {templates.length === 0 ? (
          <p className="py-4 text-center text-sm text-neutral-500">Noch keine Vorlagen. Speichere zuerst einen Trainingstag als Vorlage im Plan-Bereich.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => setSelected(template)}
                className="card-quiet flex items-center gap-3 !py-3 text-left"
              >
                <span className="icon-chip accent-primary h-10 w-10 shrink-0">
                  <Layers size={17} strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-neutral-900">{template.name}</p>
                  <p className="truncate text-xs text-neutral-500">
                    {template.items.length} {template.items.length === 1 ? 'Übung' : 'Übungen'}
                    {template.items.length > 0 ? ` · ${templateExerciseSummary(template.items, 2)}` : ''}
                  </p>
                </div>
                <ChevronRight size={16} className="shrink-0 text-neutral-400" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
