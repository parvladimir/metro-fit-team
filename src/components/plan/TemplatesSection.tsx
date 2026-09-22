'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, ChevronRight, Copy, CopyPlus, Layers, Pencil, Trash2, X } from 'lucide-react';
import {
  createDayFromTemplateAction,
  deleteTemplateAction,
  duplicateTemplateAction,
  removeDeadTemplateItemsAction,
  renameTemplateAction,
} from '@/app/(app)/plan/actions';
import { TEMPLATE_NAME_MAX_LENGTH, hasRemovedExercises, templateExerciseSummary } from '@/lib/plan-templates';
import { formatGermanDateShort } from '@/lib/date';
import { t, type TranslationKey } from '@/lib/i18n';
import type { PlanTemplateWithItems } from '@/lib/data/plan-templates';
import { ShareToTeamChatButton } from '@/components/sharing/ShareToTeamChatButton';
import type { SharePreviewSource } from '@/components/sharing/SharePreviewSheet';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export interface DayStatus {
  weekday: number;
  label: string;
  isRestDay: boolean;
  exerciseCount: number;
}

export function TemplatesSection({
  templates,
  dayStatuses,
  teamId,
}: {
  templates: PlanTemplateWithItems[];
  dayStatuses: DayStatus[];
  teamId: string | null;
}) {
  const [applyTemplate, setApplyTemplate] = useState<PlanTemplateWithItems | null>(null);
  const [renameTarget, setRenameTarget] = useState<PlanTemplateWithItems | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlanTemplateWithItems | null>(null);

  if (templates.length === 0) {
    return (
      <section className="flex flex-col gap-2.5">
        <p className="section-title">Meine Vorlagen</p>
        <div className="card-quiet flex items-center gap-3 py-4">
          <span className="icon-chip accent-primary h-10 w-10">
            <Layers size={18} strokeWidth={2} />
          </span>
          <p className="text-sm text-neutral-500">
            Noch keine Vorlagen. Speichere die Übungen eines Trainingstags, um sie später für einen anderen Tag wiederzuverwenden.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2.5">
      <p className="section-title">Meine Vorlagen</p>
      <div className="flex flex-col gap-2.5">
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            teamId={teamId}
            onApply={() => setApplyTemplate(template)}
            onRename={() => setRenameTarget(template)}
            onDelete={() => setDeleteTarget(template)}
          />
        ))}
      </div>

      {applyTemplate && (
        <WeekdayPickerSheet template={applyTemplate} dayStatuses={dayStatuses} onClose={() => setApplyTemplate(null)} />
      )}
      {renameTarget && <RenameDialog template={renameTarget} onClose={() => setRenameTarget(null)} />}
      {deleteTarget && <DeleteConfirmDialog template={deleteTarget} onClose={() => setDeleteTarget(null)} />}
    </section>
  );
}

function TemplateCard({
  template,
  teamId,
  onApply,
  onRename,
  onDelete,
}: {
  template: PlanTemplateWithItems;
  teamId: string | null;
  onApply: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const summary = templateExerciseSummary(template.items);
  const shareSource: SharePreviewSource = {
    sourceType: 'template',
    sourceTemplateId: template.id,
    defaultTitle: template.name,
    items: template.items.map((i) => ({ name: i.exercise_name, hasWeight: i.target_weight_kg != null, hasInstructions: !!i.exercise?.instructions })),
  };
  const removedExercises = hasRemovedExercises(template.items);
  const dateLabel = template.last_used_at
    ? `Zuletzt genutzt ${formatGermanDateShort(template.last_used_at)}`
    : `Erstellt am ${formatGermanDateShort(template.created_at)}`;

  function duplicate() {
    setError(null);
    start(async () => {
      const result = await duplicateTemplateAction(template.id);
      if (!result.ok) setError(result.error ?? 'Vorlage konnte nicht dupliziert werden.');
    });
  }

  function cleanup() {
    setError(null);
    start(async () => {
      const result = await removeDeadTemplateItemsAction(template.id);
      if (!result.ok) setError(result.error ?? 'Konnte nicht bereinigt werden.');
    });
  }

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="icon-chip accent-primary h-11 w-11 shrink-0">
          <Layers size={19} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-base font-bold text-neutral-900">{template.name}</p>
          <p className="text-xs text-neutral-500">
            {template.items.length} {template.items.length === 1 ? 'Übung' : 'Übungen'}
          </p>
          {summary && <p className="mt-1 break-words text-sm text-neutral-400">{summary}</p>}
          <p className="mt-1 text-[11px] text-neutral-500">{dateLabel}</p>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1">
          <button type="button" onClick={onRename} aria-label="Vorlage umbenennen" className="btn-icon">
            <Pencil size={16} />
          </button>
          <button type="button" disabled={pending} onClick={duplicate} aria-label="Vorlage duplizieren" className="btn-icon">
            <Copy size={16} />
          </button>
          <ShareToTeamChatButton teamId={teamId} source={shareSource} iconOnly className="btn-icon" />
          <button type="button" onClick={onDelete} aria-label="Vorlage löschen" className="btn-icon text-red-400">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {removedExercises && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-surface-1 px-3 py-2">
          <p className="flex items-start gap-1.5 text-xs text-neutral-500">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-accent-warning" />
            Eine gespeicherte Übung wurde gelöscht.
          </p>
          <button type="button" disabled={pending} className="shrink-0 text-xs font-semibold text-brand" onClick={cleanup}>
            Entfernen
          </button>
        </div>
      )}

      {error && <p className="text-xs font-medium text-red-400">{error}</p>}

      <button type="button" onClick={onApply} className="btn-secondary">
        <CopyPlus size={17} strokeWidth={2.1} />
        Aus Vorlage erstellen
      </button>
    </div>
  );
}

function WeekdayPickerSheet({
  template,
  dayStatuses,
  onClose,
}: {
  template: PlanTemplateWithItems;
  dayStatuses: DayStatus[];
  onClose: () => void;
}) {
  const [confirmWeekday, setConfirmWeekday] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function apply(weekday: number) {
    setError(null);
    start(async () => {
      const result = await createDayFromTemplateAction(template.id, weekday);
      if (!result.ok) {
        setError(result.error ?? 'Konnte nicht erstellt werden.');
        return;
      }
      onClose();
    });
  }

  function pick(status: DayStatus) {
    if (!status.isRestDay && status.exerciseCount > 0) {
      setConfirmWeekday(status.weekday);
      return;
    }
    apply(status.weekday);
  }

  const confirming = dayStatuses.find((d) => d.weekday === confirmWeekday);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose} role="dialog" aria-modal="true" aria-label="Aus Vorlage erstellen">
      <div
        className="mx-auto max-h-[88dvh] w-full max-w-app overflow-y-auto rounded-t-3xl border-t border-white/10 bg-surface-2 p-4"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300" />

        {!confirming ? (
          <>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-neutral-900">Für welchen Tag?</h2>
              <button type="button" onClick={onClose} aria-label="Schließen" className="btn-icon">
                <X size={18} />
              </button>
            </div>
            <p className="mb-3 text-sm text-neutral-500">„{template.name}“ wird für den ausgewählten Tag übernommen.</p>
            {error && <p className="mb-2 text-sm font-medium text-red-400">{error}</p>}
            <div className="flex flex-col gap-2">
              {WEEKDAYS.map((weekday) => {
                const status = dayStatuses.find((d) => d.weekday === weekday) ?? {
                  weekday,
                  label: t(`weekday.${weekday}` as TranslationKey),
                  isRestDay: false,
                  exerciseCount: 0,
                };
                return (
                  <button
                    key={weekday}
                    type="button"
                    disabled={pending}
                    onClick={() => pick(status)}
                    className="card-quiet flex items-center justify-between gap-3 !py-3 text-left"
                  >
                    <span className="text-sm font-semibold text-neutral-900">{status.label}</span>
                    <span className="flex items-center gap-2 text-xs text-neutral-500">
                      {status.isRestDay
                        ? 'Ruhetag'
                        : status.exerciseCount > 0
                          ? `${status.exerciseCount} ${status.exerciseCount === 1 ? 'Übung' : 'Übungen'}`
                          : 'Leer'}
                      <ChevronRight size={16} className="text-neutral-400" />
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="mb-3 flex items-start justify-between gap-3">
              <span className="icon-chip accent-warning h-11 w-11 shrink-0">
                <AlertTriangle size={20} strokeWidth={2.1} />
              </span>
              <button type="button" onClick={() => setConfirmWeekday(null)} aria-label="Zurück" className="btn-icon">
                <X size={18} />
              </button>
            </div>
            <h2 className="text-lg font-bold text-neutral-900">Bestehende Übungen ersetzen?</h2>
            <p className="mt-1.5 text-sm text-neutral-500">
              {confirming.label} hat bereits {confirming.exerciseCount} {confirming.exerciseCount === 1 ? 'Übung' : 'Übungen'}. Diese werden durch „{template.name}“ ersetzt.
            </p>
            {error && <p className="mt-2 text-sm font-medium text-red-400">{error}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" disabled={pending} onClick={() => setConfirmWeekday(null)} className="btn-secondary flex-1">
                Abbrechen
              </button>
              <button type="button" disabled={pending} onClick={() => apply(confirming.weekday)} className="btn-primary flex-1">
                {pending ? 'Wird ersetzt…' : 'Ersetzen'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RenameDialog({ template, onClose }: { template: PlanTemplateWithItems; onClose: () => void }) {
  const [name, setName] = useState(template.name);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    start(async () => {
      const result = await renameTemplateAction(template.id, name);
      if (!result.ok) {
        setError(result.error ?? 'Vorlage konnte nicht umbenannt werden.');
        return;
      }
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5" role="dialog" aria-modal="true" aria-labelledby="rename-template-title">
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-neutral-100 p-5">
        <div className="flex items-start justify-between gap-3">
          <span className="icon-chip accent-primary h-11 w-11 shrink-0">
            <Pencil size={19} strokeWidth={2.1} />
          </span>
          <button type="button" onClick={onClose} aria-label="Schließen" className="btn-icon">
            <X size={18} />
          </button>
        </div>
        <h2 id="rename-template-title" className="mt-3 text-lg font-bold text-neutral-900">Vorlage umbenennen</h2>
        <div className="mt-4">
          <label className="label" htmlFor="rename-template-name">Name der Vorlage</label>
          <input
            id="rename-template-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={TEMPLATE_NAME_MAX_LENGTH}
            autoFocus
            className="input-field w-full"
          />
        </div>
        {error && <p className="mt-2 text-sm font-medium text-red-400">{error}</p>}
        <div className="mt-5 flex gap-2">
          <button type="button" disabled={pending} onClick={onClose} className="btn-secondary flex-1">
            Abbrechen
          </button>
          <button type="button" disabled={pending || !name.trim()} onClick={submit} className="btn-primary flex-1">
            {pending ? 'Wird gespeichert…' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmDialog({ template, onClose }: { template: PlanTemplateWithItems; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove() {
    setError(null);
    start(async () => {
      const result = await deleteTemplateAction(template.id);
      if (!result.ok) {
        setError(result.error ?? 'Vorlage konnte nicht gelöscht werden.');
        return;
      }
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5" role="alertdialog" aria-modal="true" aria-labelledby="delete-template-title">
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-neutral-100 p-5">
        <div className="flex items-start justify-between gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-400">
            <Trash2 size={20} />
          </span>
          <button type="button" onClick={onClose} aria-label="Schließen" className="btn-icon">
            <X size={18} />
          </button>
        </div>
        <h2 id="delete-template-title" className="mt-3 text-lg font-bold text-neutral-900">Vorlage wirklich löschen?</h2>
        <p className="mt-1.5 text-sm text-neutral-500">
          „{template.name}“ wird entfernt. Tage, die bereits aus dieser Vorlage erstellt wurden, bleiben unverändert.
        </p>
        {error && <p className="mt-2 text-sm font-medium text-red-400">{error}</p>}
        <div className="mt-5 flex gap-2">
          <button type="button" disabled={pending} onClick={onClose} className="btn-secondary flex-1">
            Abbrechen
          </button>
          <button type="button" disabled={pending} onClick={remove} className="btn flex-1 bg-red-500 text-white active:bg-red-600">
            {pending ? 'Wird gelöscht…' : 'Vorlage löschen'}
          </button>
        </div>
      </div>
    </div>
  );
}
