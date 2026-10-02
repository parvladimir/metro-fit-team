'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ListEnd, MoreHorizontal, Replace } from 'lucide-react';
import type { PickerExercise } from '@/components/exercises/ExercisePicker';
import { ReplaceExerciseSheet } from '@/components/workout/ReplaceExerciseSheet';
import { Sheet } from '@/components/ui/Sheet';
import { postponeExerciseAction, type ReplaceExerciseResult } from '@/app/(app)/aktivitaet/workout-exercise-actions';
import { clearDraft } from '@/lib/workout-drafts';
import type { ExerciseType } from '@/types/database';

export interface ExerciseRowInfo {
  id: string;
  exerciseId: string;
  name: string;
  type: ExerciseType;
  hasSets: boolean;
  isLast: boolean;
}

interface ExerciseActionsValue {
  enabled: boolean;
  openMenu: (workoutExerciseId: string) => void;
  /** Lets an exercise's input form say whether it holds unsaved input. Returns the unregister function. */
  registerDraftProbe: (workoutExerciseId: string, probe: () => boolean) => () => void;
  /** True once an exercise row was replaced away in this workout (its draft must not be written again). */
  isRowRemoved: (workoutExerciseId: string) => boolean;
}

const NOOP: ExerciseActionsValue = {
  enabled: false,
  openMenu: () => undefined,
  registerDraftProbe: () => () => undefined,
  isRowRemoved: () => false,
};

const Ctx = createContext<ExerciseActionsValue>(NOOP);

/** Works without a provider too (an exercise form outside the running workout screen). */
export function useExerciseActions(): ExerciseActionsValue {
  return useContext(Ctx);
}

function scrollToCard(workoutExerciseId: string) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let tries = 0;
  const tick = () => {
    const el = document.getElementById(`we-${workoutExerciseId}`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      el.focus({ preventScroll: true });
      return;
    }
    tries += 1;
    if (tries < 30) window.setTimeout(tick, 100); // the refreshed list may take a moment to arrive
  };
  tick();
}

type Toast = { text: string; tone: 'ok' | 'error' };

/**
 * One place for the actions on the exercises of the RUNNING workout: the "⋯" menu of each
 * exercise card, "Übung ersetzen" (one sheet for the whole screen, not one per card) and
 * "Später ausführen". The page passes in only what the sheets need.
 */
export function ExerciseActionsProvider({
  userId,
  workoutId,
  enabled,
  rows,
  catalogue,
  children,
}: {
  userId: string;
  workoutId: string;
  /** False until the database has the replace/postpone functions: the controls then stay hidden. */
  enabled: boolean;
  rows: ExerciseRowInfo[];
  catalogue: PickerExercise[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const probes = useRef(new Map<string, () => boolean>());
  const removed = useRef(new Set<string>());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [replaceFor, setReplaceFor] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [, startTransition] = useTransition();

  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  const registerDraftProbe = useCallback((id: string, probe: () => boolean) => {
    probes.current.set(id, probe);
    return () => {
      if (probes.current.get(id) === probe) probes.current.delete(id);
    };
  }, []);
  const isRowRemoved = useCallback((id: string) => removed.current.has(id), []);
  const openMenu = useCallback((id: string) => setMenuFor(id), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.tone === 'error' ? 7000 : 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function postpone(row: ExerciseRowInfo) {
    setMenuFor(null);
    startTransition(async () => {
      try {
        const res = await postponeExerciseAction({ workoutId, workoutExerciseId: row.id });
        if (!res.ok) {
          setToast({ text: res.error, tone: 'error' });
          router.refresh();
          return;
        }
        setToast({ text: res.changed ? `${row.name} wird am Ende des Trainings ausgeführt.` : `${row.name} ist bereits die letzte Übung.`, tone: 'ok' });
      } catch {
        setToast({ text: 'Keine Verbindung. Die Reihenfolge wurde nicht geändert.', tone: 'error' });
      }
    });
  }

  function replaced(res: Extract<ReplaceExerciseResult, { ok: true }>, replacement: PickerExercise) {
    const row = replaceFor ? rowById.get(replaceFor) : undefined;
    setReplaceFor(null);
    if (res.removedWorkoutExerciseId && row) {
      // The old row is gone: its unsaved input and its local draft go with it.
      removed.current.add(res.removedWorkoutExerciseId);
      probes.current.delete(res.removedWorkoutExerciseId);
      clearDraft({ userId, workoutId, workoutExerciseId: res.removedWorkoutExerciseId, type: row.type });
    }
    setToast({
      text: row
        ? res.mode === 'added'
          ? `${replacement.name} hinzugefügt. Deine bisherigen Sätze bleiben bei ${row.name}.`
          : `${replacement.name} statt ${row.name} – gilt nur für dieses Training.`
        : `${replacement.name} ist jetzt Teil dieses Trainings.`,
      tone: 'ok',
    });
    scrollToCard(res.newWorkoutExerciseId);
  }

  const value = useMemo<ExerciseActionsValue>(() => ({ enabled, openMenu, registerDraftProbe, isRowRemoved }), [enabled, openMenu, registerDraftProbe, isRowRemoved]);

  const menuRow = menuFor ? rowById.get(menuFor) : undefined;
  const replaceRow = replaceFor ? rowById.get(replaceFor) : undefined;

  return (
    <Ctx.Provider value={value}>
      {children}

      {menuRow && (
        <Sheet title={menuRow.name} onClose={() => setMenuFor(null)}>
          <div className="flex flex-col gap-1 pb-1">
            <button
              type="button"
              onClick={() => {
                setReplaceFor(menuRow.id);
                setMenuFor(null);
              }}
              className="flex min-h-[56px] items-center gap-3 rounded-2xl px-3 py-2 text-left active:bg-neutral-150"
            >
              <Replace size={19} className="shrink-0 text-brand" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-neutral-900">Übung ersetzen</span>
                <span className="block text-xs text-neutral-500">Nur für dieses Training</span>
              </span>
            </button>
            <button
              type="button"
              disabled={menuRow.isLast}
              onClick={() => postpone(menuRow)}
              className="flex min-h-[56px] items-center gap-3 rounded-2xl px-3 py-2 text-left active:bg-neutral-150 disabled:opacity-50"
            >
              <ListEnd size={19} className="shrink-0 text-brand" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-neutral-900">Später ausführen</span>
                <span className="block text-xs text-neutral-500">{menuRow.isLast ? 'Das ist schon die letzte Übung' : 'Ans Ende dieses Trainings verschieben'}</span>
              </span>
            </button>
          </div>
        </Sheet>
      )}

      {replaceRow && (
        <ReplaceExerciseSheet
          workoutId={workoutId}
          target={{ id: replaceRow.id, exerciseId: replaceRow.exerciseId, name: replaceRow.name, hasSets: replaceRow.hasSets }}
          catalogue={catalogue}
          hasUnsavedInput={probes.current.get(replaceRow.id)?.() ?? false}
          createHref={`/uebungen/neu?returnTo=${encodeURIComponent(`/aktivitaet/training/${workoutId}`)}`}
          onClose={() => setReplaceFor(null)}
          onDone={replaced}
          onRefused={() => router.refresh()}
        />
      )}

      <div className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4" style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}>
        {toast && (
          <p
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto w-full max-w-app rounded-2xl border bg-surface-2 px-4 py-3 text-sm font-semibold shadow-lg ${
              toast.tone === 'error' ? 'border-red-400/40 text-red-300' : 'border-brand/40 text-neutral-900'
            }`}
          >
            {toast.text}
          </p>
        )}
      </div>
    </Ctx.Provider>
  );
}

/** The "⋯" button in an exercise card's header. Renders nothing while the feature is not available. */
export function ExerciseMenuButton({ workoutExerciseId, exerciseName }: { workoutExerciseId: string; exerciseName: string }) {
  const { enabled, openMenu } = useExerciseActions();
  if (!enabled) return null;
  return (
    <button
      type="button"
      onClick={() => openMenu(workoutExerciseId)}
      aria-label={`Optionen für ${exerciseName}`}
      aria-haspopup="dialog"
      className="btn-icon h-11 w-11 shrink-0 bg-neutral-100 text-neutral-500"
    >
      <MoreHorizontal size={20} />
    </button>
  );
}
