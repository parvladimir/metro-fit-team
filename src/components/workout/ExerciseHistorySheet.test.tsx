// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HistoryEntry } from '@/lib/exercise-history';

const loadExerciseHistoryAction = vi.fn();
vi.mock('@/app/(app)/aktivitaet/workout-exercise-actions', () => ({ loadExerciseHistoryAction: (input: unknown) => loadExerciseHistoryAction(input) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

import { ExerciseHistorySheet } from './ExerciseHistorySheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const entry = (n: number, over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  workoutId: `w-${n}`,
  workoutExerciseId: `we-${n}`,
  performedAt: `2026-09-0${n}T10:00:00Z`,
  instanceNo: 1,
  instanceCount: 1,
  sets: [{ set_number: 1, weight_kg: 70 + n, reps: 10, distance_km: null, duration_seconds: null, metrics: {} }],
  ...over,
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  loadExerciseHistoryAction.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mount() {
  await act(async () => {
    root.render(<ExerciseHistorySheet exerciseId="ex-1" exerciseName="Bankdrücken" exerciseType="strength" workoutId="w-now" onClose={() => undefined} />);
    await Promise.resolve();
    await Promise.resolve();
  });
}
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement;
const byText = (text: string) => [...dialog().querySelectorAll('button')].find((b) => b.textContent?.includes(text));
async function click(el: Element | undefined) {
  await act(async () => {
    (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ExerciseHistorySheet', () => {
  it('lists the earlier sessions with their sets and a link to each workout, and says they are only a guide', async () => {
    loadExerciseHistoryAction.mockResolvedValue({ ok: true, entries: [entry(2), entry(1)], hasMore: false });
    await mount();
    expect(dialog().textContent).toContain('Frühere Werte dienen als Orientierung.');
    expect(dialog().textContent).toContain('72 kg · 10 Wdh.');
    expect(dialog().textContent).toContain('71 kg · 10 Wdh.');
    expect([...dialog().querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/aktivitaet/training/w-2/zusammenfassung', '/aktivitaet/training/w-1/zusammenfassung']);
    expect(loadExerciseHistoryAction).toHaveBeenCalledWith({ exerciseId: 'ex-1', excludeWorkoutId: 'w-now', before: null });
  });

  it('two blocks of the same exercise in one workout stay two blocks', async () => {
    loadExerciseHistoryAction.mockResolvedValue({ ok: true, entries: [entry(1, { instanceNo: 1, instanceCount: 2 }), entry(1, { workoutExerciseId: 'we-1b', instanceNo: 2, instanceCount: 2 })], hasMore: false });
    await mount();
    expect(dialog().textContent).toContain('Block 1 von 2');
    expect(dialog().textContent).toContain('Block 2 von 2');
  });

  it('no earlier entries and a failed load are different messages, and the failure can be retried', async () => {
    loadExerciseHistoryAction.mockResolvedValueOnce({ ok: true, entries: [], hasMore: false });
    await mount();
    expect(dialog().textContent).toContain('Noch keine früheren Einträge.');
    act(() => root.unmount());
    root = createRoot(container);
    loadExerciseHistoryAction.mockResolvedValueOnce({ ok: false, error: 'x' }).mockResolvedValueOnce({ ok: true, entries: [entry(1)], hasMore: false });
    await mount();
    expect(dialog().textContent).toContain('Der Verlauf konnte nicht geladen werden.');
    expect(dialog().textContent).not.toContain('Noch keine früheren Einträge.');
    await click(byText('Erneut versuchen'));
    expect(dialog().textContent).toContain('71 kg · 10 Wdh.');
  });

  it('older entries load on request, from where the list ends — and a failure of that says so instead of doing nothing', async () => {
    loadExerciseHistoryAction.mockResolvedValueOnce({ ok: true, entries: [entry(2)], hasMore: true });
    await mount();
    loadExerciseHistoryAction.mockResolvedValueOnce({ ok: false, error: 'x' });
    await click(byText('Ältere Einträge laden'));
    expect(loadExerciseHistoryAction).toHaveBeenLastCalledWith({ exerciseId: 'ex-1', excludeWorkoutId: 'w-now', before: '2026-09-02T10:00:00Z' });
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('Ältere Einträge konnten nicht geladen werden.');
    expect(dialog().textContent).toContain('72 kg · 10 Wdh.'); // what was shown stays
    loadExerciseHistoryAction.mockResolvedValueOnce({ ok: true, entries: [entry(1)], hasMore: false });
    await click(byText('Erneut versuchen'));
    expect(dialog().textContent).toContain('71 kg · 10 Wdh.');
    expect(dialog().querySelector('[role="alert"]')).toBeNull();
    expect(byText('Ältere Einträge laden')).toBeUndefined(); // nothing further
  });
});
