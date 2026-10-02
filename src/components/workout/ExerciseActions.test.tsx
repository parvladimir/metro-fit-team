// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { clearDraft, draftKey, readDraft, writeDraft } from '@/lib/workout-drafts';

const replaceExerciseAction = vi.fn();
const postponeExerciseAction = vi.fn();
vi.mock('@/app/(app)/aktivitaet/workout-exercise-actions', () => ({
  replaceExerciseAction: (input: unknown) => replaceExerciseAction(input),
  postponeExerciseAction: (input: unknown) => postponeExerciseAction(input),
}));
vi.mock('@/app/(app)/aktivitaet/actions', () => ({ addSetAction: vi.fn() }));
vi.mock('@/components/workout/ExerciseHistorySheet', () => ({ ExerciseHistorySheet: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { SetLogger } from '@/components/workout/SetLogger';
import { ExerciseActionsProvider, ExerciseMenuButton, useExerciseActions, type ExerciseRowInfo } from '@/components/workout/ExerciseActions';
import type { PickerExercise } from '@/components/exercises/ExercisePicker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.get(key) ?? null; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, String(value)); }
}

const catalogue: PickerExercise[] = [
  { id: 'ex-bench', name: 'Bankdrücken', exercise_type: 'strength', muscle_group: 'chest', is_custom: false },
  { id: 'ex-incline', name: 'Schrägbankdrücken Kurzhantel', exercise_type: 'strength', muscle_group: 'chest', is_custom: false },
  { id: 'ex-squat', name: 'Kniebeugen', exercise_type: 'strength', muscle_group: 'legs', is_custom: false },
  { id: 'ex-mine', name: 'Mein Klimmzug', exercise_type: 'bodyweight', muscle_group: 'back', is_custom: true },
];
const rows = (over: Partial<ExerciseRowInfo>[] = []): ExerciseRowInfo[] =>
  [
    { id: 'we-bench', exerciseId: 'ex-bench', name: 'Bankdrücken', type: 'strength' as const, hasSets: false, isLast: false },
    { id: 'we-squat', exerciseId: 'ex-squat', name: 'Kniebeugen', type: 'strength' as const, hasSets: false, isLast: true },
  ].map((r, i) => ({ ...r, ...(over[i] ?? {}) }));

let container: HTMLDivElement;
let root: Root;
let storage: MemoryStorage;

let isRowRemoved: (id: string) => boolean = () => false;

/** Stands in for a set logger: reports unsaved input when asked, and can ask whether its row was replaced away. */
function Probe({ id, dirty }: { id: string; dirty: boolean }) {
  const actions = useExerciseActions();
  isRowRemoved = actions.isRowRemoved;
  useEffect(() => actions.registerDraftProbe(id, () => dirty), [actions, id, dirty]);
  return null;
}

function mount(props: { enabled?: boolean; rows?: ExerciseRowInfo[]; dirty?: boolean } = {}) {
  act(() =>
    root.render(
      <ExerciseActionsProvider userId="user-1" workoutId="workout-1" enabled={props.enabled ?? true} rows={props.rows ?? rows()} catalogue={catalogue}>
        <ExerciseMenuButton workoutExerciseId="we-bench" exerciseName="Bankdrücken" />
        <ExerciseMenuButton workoutExerciseId="we-squat" exerciseName="Kniebeugen" />
        <Probe id="we-bench" dirty={props.dirty ?? false} />
      </ExerciseActionsProvider>,
    ),
  );
}

const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const buttons = () => [...(dialog()?.querySelectorAll('button') ?? [])] as HTMLButtonElement[];
const byText = (text: string) => buttons().find((b) => b.textContent?.trim().includes(text));
function click(el: HTMLElement | null | undefined) {
  if (!el) throw new Error('element not found');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
const menuButton = (name: string) => container.querySelector(`button[aria-label="Optionen für ${name}"]`) as HTMLButtonElement | null;
function openReplace(rowName = 'Bankdrücken') {
  click(menuButton(rowName));
  click(byText('Übung ersetzen'));
}
function pick(name: string) {
  const row = [...(dialog()?.querySelectorAll('li button') ?? [])].find((b) => b.textContent?.startsWith(name));
  click(row as HTMLElement);
}

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  replaceExerciseAction.mockReset();
  postponeExerciseAction.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('exercise menu', () => {
  it('stays out of the way while the database does not have the functions yet', () => {
    mount({ enabled: false });
    expect(menuButton('Bankdrücken')).toBeNull();
  });

  it('offers exactly the two actions, and "Später ausführen" is unavailable for the last exercise', () => {
    mount();
    click(menuButton('Bankdrücken'));
    expect(byText('Übung ersetzen')).toBeTruthy();
    expect(byText('Später ausführen')?.disabled).toBe(false);
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(dialog()).toBeNull();

    click(menuButton('Kniebeugen'));
    expect(byText('Später ausführen')?.disabled).toBe(true);
    expect(dialog()?.textContent).toContain('Das ist schon die letzte Übung');
  });

  it('postponing moves nothing locally — it asks the server, tells the user and offers no undo that could lose data', async () => {
    postponeExerciseAction.mockResolvedValue({ ok: true, changed: true });
    mount();
    click(menuButton('Bankdrücken'));
    click(byText('Später ausführen'));
    await flush();
    expect(postponeExerciseAction).toHaveBeenCalledWith({ workoutId: 'workout-1', workoutExerciseId: 'we-bench' });
    expect(document.body.textContent).toContain('Bankdrücken wird am Ende des Trainings ausgeführt.');
    expect(dialog()).toBeNull();
  });

  it('a failed postpone shows the reason', async () => {
    postponeExerciseAction.mockResolvedValue({ ok: false, error: 'Dieses Training ist bereits beendet.' });
    mount();
    click(menuButton('Bankdrücken'));
    click(byText('Später ausführen'));
    await flush();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe('Dieses Training ist bereits beendet.');
  });
});

describe('replace sheet', () => {
  it('states that only this workout changes, lists what the user may use and blocks the current exercise', () => {
    mount();
    openReplace();
    expect(dialog()?.textContent).toContain('Die Änderung gilt nur für dieses Training. Dein Plan und deine Vorlage bleiben unverändert.');
    const rowsText = [...dialog()!.querySelectorAll('li button')].map((b) => [b.textContent, (b as HTMLButtonElement).disabled]);
    expect(rowsText.length).toBe(4);
    expect(rowsText.find(([t]) => String(t).startsWith('Bankdrücken'))?.[1]).toBe(true); // cannot "replace" it with itself
    expect(dialog()?.textContent).toContain('Meine Übungen');
  });

  it('search ignores case and umlauts', () => {
    mount();
    openReplace();
    const search = dialog()!.querySelector('input[type="search"]') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'schragbank');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect([...dialog()!.querySelectorAll('li button')].map((b) => b.textContent)).toEqual(['Schrägbankdrücken KurzhantelKraft']);
  });

  it('with no recorded sets the replacement takes the place — and says so when unsaved input would be lost', () => {
    mount({ dirty: true });
    openReplace();
    pick('Kniebeugen');
    expect(dialog()?.textContent).toContain('Kniebeugen übernimmt den Platz von Bankdrücken.');
    expect(dialog()?.textContent).toContain('Deine nicht gespeicherten Eingaben bei Bankdrücken gehen dabei verloren.');
    expect(byText('Ersetzen')).toBeTruthy();
  });

  it('no warning when there is nothing unsaved', () => {
    mount({ dirty: false });
    openReplace();
    pick('Kniebeugen');
    expect(dialog()?.textContent).not.toContain('gehen dabei verloren');
  });

  it('with recorded sets the original stays, and nothing is lost so there is no warning', () => {
    mount({ rows: rows([{ hasSets: true }]), dirty: true });
    openReplace();
    pick('Schrägbankdrücken');
    expect(dialog()?.textContent).toContain('Bereits erfasste Sätze bleiben bei Bankdrücken. Für weitere Sätze wird Schrägbankdrücken Kurzhantel hinzugefügt.');
    expect(byText('Hinzufügen')).toBeTruthy();
    expect(dialog()?.textContent).not.toContain('gehen dabei verloren');
  });

  it('sends one request id for the choice and keeps it for a retry; a different choice gets a new one', async () => {
    replaceExerciseAction.mockResolvedValueOnce({ ok: false, error: 'Die Anfrage konnte nicht verarbeitet werden. Bitte versuche es erneut.' }).mockRejectedValueOnce(new Error('offline'));
    mount();
    openReplace();
    pick('Kniebeugen');
    click(byText('Ersetzen'));
    await flush();
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain('Anfrage konnte nicht verarbeitet werden');
    click(byText('Ersetzen'));
    await flush();
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain('Keine Verbindung');
    const [first, second] = replaceExerciseAction.mock.calls.map((c) => c[0]);
    expect(second.requestId).toBe(first.requestId); // a retry is the same request
    expect(first).toMatchObject({ workoutId: 'workout-1', workoutExerciseId: 'we-bench', newExerciseId: 'ex-squat' });

    click(byText('Zurück'));
    pick('Mein Klimmzug');
    replaceExerciseAction.mockResolvedValueOnce({ ok: true, mode: 'replaced', newWorkoutExerciseId: 'we-new', removedWorkoutExerciseId: 'we-bench', replayed: false });
    click(byText('Ersetzen'));
    await flush();
    expect(replaceExerciseAction.mock.calls[2]![0].requestId).not.toBe(first.requestId);
  });

  it('after a replacement the removed row loses its draft for good; the original of an "added" block keeps it', async () => {
    const scope = { userId: 'user-1', workoutId: 'workout-1', workoutExerciseId: 'we-bench', type: 'strength' as const };
    writeDraft(scope, 'ex-bench', { values: { weight: '80' } }, Date.now());
    replaceExerciseAction.mockResolvedValueOnce({ ok: true, mode: 'replaced', newWorkoutExerciseId: 'we-new', removedWorkoutExerciseId: 'we-bench', replayed: false });
    mount();
    openReplace();
    pick('Kniebeugen');
    click(byText('Ersetzen'));
    await flush();
    expect(readDraft(scope, 'ex-bench', Date.now()).status).toBe('none');
    expect(storage.getItem(draftKey(scope))).toBeNull();
    expect(isRowRemoved('we-bench')).toBe(true); // its set logger must not write it again
    expect(isRowRemoved('we-squat')).toBe(false);
    expect(document.body.textContent).toContain('Kniebeugen statt Bankdrücken – gilt nur für dieses Training.');
    expect(dialog()).toBeNull();

    clearDraft(scope);
    writeDraft(scope, 'ex-bench', { values: { weight: '80' } }, Date.now());
    replaceExerciseAction.mockResolvedValueOnce({ ok: true, mode: 'added', newWorkoutExerciseId: 'we-new2', removedWorkoutExerciseId: null, replayed: false });
    mount({ rows: rows([{ hasSets: true }]) });
    openReplace();
    pick('Schrägbankdrücken');
    click(byText('Hinzufügen'));
    await flush();
    expect(readDraft(scope, 'ex-bench', Date.now()).status).toBe('ok');
    expect(document.body.textContent).toContain('Deine bisherigen Sätze bleiben bei Bankdrücken.');
  });

  it('a replaced exercise\'s own form cannot write its draft back when it goes away (integration with the real set logger)', async () => {
    vi.useFakeTimers();
    replaceExerciseAction.mockResolvedValue({ ok: true, mode: 'replaced', newWorkoutExerciseId: 'we-new', removedWorkoutExerciseId: 'we-bench', replayed: false });
    const logger = (
      <SetLogger
        userId="user-1"
        workoutId="workout-1"
        workoutExerciseId="we-bench"
        exerciseId="ex-bench"
        exerciseType="strength"
        exerciseName="Bankdrücken"
        savedSets={[]}
        lastResult={{ status: 'none' }}
        historyEnabled
      />
    );
    const tree = (withLogger: boolean) => (
      <ExerciseActionsProvider userId="user-1" workoutId="workout-1" enabled rows={rows()} catalogue={catalogue}>
        <ExerciseMenuButton workoutExerciseId="we-bench" exerciseName="Bankdrücken" />
        {withLogger ? logger : null}
      </ExerciseActionsProvider>
    );
    act(() => root.render(tree(true)));
    const weight = container.querySelector('input[name="weight"]') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(weight, '80');
      weight.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => vi.advanceTimersByTime(500));
    expect(storage.length).toBe(1); // the draft exists

    openReplace();
    pick('Kniebeugen');
    expect(dialog()?.textContent).toContain('gehen dabei verloren'); // the real form reported its unsaved input
    click(byText('Ersetzen'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(storage.length).toBe(0); // cleared with the row

    act(() => root.render(tree(false))); // the refreshed screen no longer has that card: its form unmounts
    act(() => vi.advanceTimersByTime(1000));
    expect(storage.length).toBe(0); // and the unmount did not write the draft back
    vi.useRealTimers();
  });
});
