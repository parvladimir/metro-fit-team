// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { LastResultState } from '@/lib/exercise-history';
import { markWorkoutEnded, readDraft, unmarkWorkoutEnded } from '@/lib/workout-drafts';

const addSetAction = vi.fn();
vi.mock('@/app/(app)/aktivitaet/actions', () => ({ addSetAction: (fd: FormData) => addSetAction(fd) }));
vi.mock('@/app/(app)/aktivitaet/workout-exercise-actions', () => ({}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/components/workout/ExerciseHistorySheet', () => ({ ExerciseHistorySheet: () => null }));

import { SetLogger, type SavedSet } from '@/components/workout/SetLogger';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = Parameters<typeof SetLogger>[0];
const base: Props = {
  userId: 'user-1',
  workoutId: 'workout-1',
  workoutExerciseId: 'we-1',
  exerciseId: 'ex-bench',
  exerciseType: 'strength',
  exerciseName: 'Bankdrücken',
  savedSets: [],
  lastResult: { status: 'none' },
  historyEnabled: true,
};

const set = (over: Partial<SavedSet> = {}): SavedSet => ({ set_number: 1, weight_kg: 80, reps: 10, distance_km: null, duration_seconds: null, metrics: {}, ...over });
const last = (sets: Array<Partial<SavedSet>>): LastResultState => ({
  status: 'ok',
  entry: {
    workoutId: 'w-old',
    workoutExerciseId: 'we-old',
    performedAt: '2026-09-27T16:00:00Z',
    instanceNo: 1,
    instanceCount: 1,
    sets: sets.map((s, i) => ({ set_number: i + 1, weight_kg: null, reps: null, distance_km: null, duration_seconds: null, metrics: {}, ...s })),
  },
});

/** Node's own experimental localStorage global shadows jsdom's, so the tests bring their own. */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.get(key) ?? null; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, String(value)); }
}
let storage: MemoryStorage;

let container: HTMLDivElement;
let root: Root;

function render(props: Partial<Props> = {}) {
  act(() => root.render(createElement(SetLogger, { ...base, ...props })));
}
const form = () => container.querySelector('form') as HTMLFormElement;
const input = (name: string) => container.querySelector(`input[name="${name}"]`) as HTMLInputElement;
const buttonByText = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text)) as HTMLButtonElement | undefined;
const submitButton = () => container.querySelector('button[type="submit"]') as HTMLButtonElement;

function type(el: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function click(el: HTMLElement | undefined) {
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
async function submit() {
  await act(async () => {
    form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}
const sentField = (call: number, name: string) => (addSetAction.mock.calls[call]![0] as FormData).get(name);

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  addSetAction.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  unmarkWorkoutEnded('workout-1');
});

describe('SetLogger — suggestions and copying', () => {
  it('starts empty when nothing was saved yet and numbers the first set', () => {
    render();
    expect(input('weight').value).toBe('');
    expect(submitButton().textContent).toContain('Satz 1 speichern');
  });

  it('starts from the last SAVED set of this exercise, as a suggestion for the next one', () => {
    render({ savedSets: [set({ weight_kg: 82.5, reps: 8 }), set({ set_number: 2, weight_kg: 80, reps: 9 })] });
    expect(input('weight').value).toBe('80');
    expect(input('reps').value).toBe('9');
    expect(submitButton().textContent).toContain('Satz 3 speichern');
    expect(container.textContent).toContain('Werte vom letzten Satz vorbereitet – noch nicht gespeichert.');
  });

  it('"Werte übernehmen" only fills the inputs and says so — nothing is saved', () => {
    render({ lastResult: last([{ weight_kg: 80, reps: 10 }, { weight_kg: 80, reps: 9 }, { weight_kg: 75, reps: 8 }]) });
    click(buttonByText('Werte übernehmen'));
    expect(input('weight').value).toBe('80');
    expect(input('reps').value).toBe('10');
    expect(container.textContent).toContain('Werte aus Satz 1 übernommen – noch nicht gespeichert.');
    expect(addSetAction).not.toHaveBeenCalled();
    expect(submitButton().textContent).toContain('Satz 1 speichern'); // still the first set
  });

  it('copies the set that matches the next set number, and lets the user pick another one explicitly', () => {
    render({
      savedSets: [set()],
      lastResult: last([{ weight_kg: 80, reps: 10 }, { weight_kg: 80, reps: 9 }, { weight_kg: 75, reps: 8 }]),
    });
    click(buttonByText('Werte übernehmen'));
    expect(input('reps').value).toBe('9'); // set number 2
    expect(container.textContent).toContain('Werte aus Satz 2 übernommen');
    const chip = container.querySelector('button[aria-label^="Satz 3 übernehmen"]') as HTMLButtonElement;
    click(chip);
    expect(input('weight').value).toBe('75');
    expect(input('reps').value).toBe('8');
  });

  it('never replaces typed input without asking', () => {
    render({ lastResult: last([{ weight_kg: 80, reps: 10 }]) });
    type(input('weight'), '92,5');
    click(buttonByText('Werte übernehmen'));
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(input('weight').value).toBe('92,5'); // untouched while the question is open

    click(buttonByText('Behalten'));
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(input('weight').value).toBe('92,5');

    click(buttonByText('Werte übernehmen'));
    click(buttonByText('Ersetzen'));
    expect(input('weight').value).toBe('80');
  });

  it('shows "no earlier entries" and a failed lookup differently, and offers a retry only for the failure', () => {
    render({ lastResult: { status: 'none' } });
    expect(container.textContent).toContain('Noch keine früheren Einträge.');
    expect(container.textContent).not.toContain('Erneut laden');

    render({ lastResult: { status: 'error' } });
    expect(container.textContent).toContain('Frühere Werte konnten nicht geladen werden.');
    expect(container.textContent).not.toContain('Noch keine früheren Einträge.');
    expect(buttonByText('Erneut laden')).toBeTruthy();

    render({ lastResult: { status: 'hidden' } });
    expect(container.textContent).not.toContain('Letztes Mal');
    expect(container.textContent).not.toContain('Noch keine früheren');
  });

  it('a late change of the incoming props never overwrites what the user is typing', () => {
    render({ lastResult: { status: 'none' }, savedSets: [] });
    type(input('weight'), '61');
    type(input('reps'), '7');
    render({ lastResult: last([{ weight_kg: 80, reps: 10 }]), savedSets: [set({ weight_kg: 100, reps: 3 })] });
    expect(input('weight').value).toBe('61');
    expect(input('reps').value).toBe('7');
  });
});

describe('SetLogger — saving', () => {
  it('keeps weight and repetitions for the next set, drops RPE and the note, and advances the number only after the server confirmed', async () => {
    let resolve!: (v: unknown) => void;
    addSetAction.mockReturnValue(new Promise((r) => (resolve = r)));
    render();
    type(input('weight'), '80');
    type(input('reps'), '10');
    click(container.querySelector('button[aria-expanded]') as HTMLElement);
    type(input('rpe'), '9');
    type(input('notes'), 'schwer');

    await submit();
    expect(addSetAction).toHaveBeenCalledTimes(1);
    expect(submitButton().textContent).toContain('Satz 1'); // not confirmed yet: the number has not moved

    await act(async () => {
      resolve({ ok: true, setNumber: 1, replayed: false });
      await Promise.resolve();
    });
    await flush();
    expect(submitButton().textContent).toContain('Satz 2 speichern');
    expect(container.textContent).toContain('Satz 1 gespeichert.');
    expect(input('weight').value).toBe('80');
    expect(input('reps').value).toBe('10');
    expect(input('rpe').value).toBe('');
    expect(input('notes').value).toBe('');
    expect(container.querySelector('#' + CSS.escape(input('rpe').id))).not.toBeNull();
    expect(container.querySelector('button[aria-expanded="true"]')).not.toBeNull(); // the open section stays open
    // the retained values are a suggestion, not a second saved set
    expect(addSetAction).toHaveBeenCalledTimes(1);
  });

  it('sends only the fields of this exercise type, with a stable id for the entry', async () => {
    addSetAction.mockResolvedValue({ ok: true, setNumber: 1, replayed: false });
    render();
    type(input('weight'), '82,5');
    type(input('reps'), '8');
    await submit();
    expect(sentField(0, 'weight')).toBe('82,5'); // the German decimal comma goes through untouched
    expect(sentField(0, 'reps')).toBe('8');
    expect(sentField(0, 'workoutExerciseId')).toBe('we-1');
    expect(String(sentField(0, 'submissionId'))).toMatch(/^[0-9a-f-]{36}$/);
    expect(sentField(0, 'distanceKm')).toBeNull();
  });

  it('a rejected save keeps the input, shows the message and does not advance the set number', async () => {
    addSetAction.mockResolvedValue({ ok: false, error: 'Bitte prüfe deine Eingaben.' });
    render();
    type(input('weight'), '80');
    type(input('reps'), '10');
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Bitte prüfe deine Eingaben.');
    expect(input('weight').value).toBe('80');
    expect(input('reps').value).toBe('10');
    expect(submitButton().textContent).toContain('Satz 1 speichern');
    expect(container.textContent).not.toContain('gespeichert.');
  });

  it('a lost connection keeps the input and the SAME entry id, so retrying cannot store the entry twice', async () => {
    addSetAction.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ ok: true, setNumber: 1, replayed: true });
    render();
    type(input('weight'), '80');
    type(input('reps'), '10');
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Keine Verbindung');
    expect(submitButton().textContent).toContain('Erneut versuchen');
    expect(input('weight').value).toBe('80');

    await submit();
    expect(sentField(1, 'submissionId')).toBe(sentField(0, 'submissionId'));
    expect(container.textContent).toContain('Dieser Eintrag war bereits gespeichert.'); // the server recognised the entry
    expect(submitButton().textContent).toContain('Satz 2 speichern');
  });

  it('after a confirmed save the next entry gets a NEW id', async () => {
    addSetAction.mockResolvedValue({ ok: true, setNumber: 1, replayed: false });
    render();
    type(input('weight'), '80');
    type(input('reps'), '10');
    await submit();
    await submit();
    expect(sentField(1, 'submissionId')).not.toBe(sentField(0, 'submissionId'));
  });

  it('a double tap sends the same entry id twice and the second confirmation is ignored', async () => {
    addSetAction.mockResolvedValueOnce({ ok: true, setNumber: 1, replayed: false }).mockResolvedValueOnce({ ok: true, setNumber: 1, replayed: true });
    render();
    type(input('weight'), '80');
    type(input('reps'), '10');
    await act(async () => {
      form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    expect(addSetAction).toHaveBeenCalledTimes(2);
    expect(sentField(1, 'submissionId')).toBe(sentField(0, 'submissionId')); // the server treats the second as a replay
    expect(container.textContent).toContain('Satz 1 gespeichert.');
    expect(container.textContent).not.toContain('bereits gespeichert');
    expect(submitButton().textContent).toContain('Satz 2 speichern');
  });

  it('a run, a ride or a stretch is never carried over: the form folds into a saved summary with "Weiteren Eintrag hinzufügen"', async () => {
    addSetAction.mockResolvedValue({ ok: true, setNumber: 1, replayed: false });
    render({ exerciseType: 'cardio_distance', exerciseName: 'Laufband' });
    type(input('duration'), '30:00');
    type(input('distanceKm'), '5');
    await submit();
    expect(container.querySelector('form')).toBeNull();
    expect(container.textContent).toContain('Eintrag gespeichert.');
    click(buttonByText('Weiteren Eintrag hinzufügen'));
    expect(input('duration').value).toBe('');
    expect(input('distanceKm').value).toBe('');
  });

  it('a bodyweight exercise keeps its chosen mode and value', async () => {
    addSetAction.mockResolvedValue({ ok: true, setNumber: 1, replayed: false });
    render({ exerciseType: 'bodyweight', exerciseName: 'Plank' });
    click(buttonByText('Dauer'));
    type(input('duration'), '00:45');
    await submit();
    expect(input('duration').value).toBe('00:45');
    expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toBe('Dauer');
    expect(container.querySelector('input[name="reps"]')).toBeNull();
  });
});

describe('SetLogger — form controls', () => {
  it('every input of every exercise on the page has its own id, and every label points at its input', () => {
    const second = document.createElement('div');
    document.body.appendChild(second);
    const root2 = createRoot(second);
    act(() => {
      root.render(createElement(SetLogger, { ...base, workoutExerciseId: 'we-1' }));
      root2.render(createElement(SetLogger, { ...base, workoutExerciseId: 'we-2', exerciseName: 'Kniebeugen' }));
    });
    const ids = [...document.querySelectorAll('input[id]')].map((i) => i.id);
    expect(ids.length).toBeGreaterThan(4);
    expect(new Set(ids).size).toBe(ids.length);
    for (const label of document.querySelectorAll('label[for]')) expect(document.getElementById(label.getAttribute('for')!)).not.toBeNull();
    act(() => root2.unmount());
    second.remove();
  });
});

describe('SetLogger — drafts on this device', () => {
  const scope = { userId: 'user-1', workoutId: 'workout-1', workoutExerciseId: 'we-1', type: 'strength' as const };

  it('keeps unfinished input after a short pause, labelled honestly', () => {
    vi.useFakeTimers();
    render();
    type(input('weight'), '82,5');
    type(input('reps'), '8');
    expect(readDraft(scope, 'ex-bench', Date.now()).status).toBe('none'); // debounced, not written on every keystroke
    act(() => vi.advanceTimersByTime(500));
    const res = readDraft(scope, 'ex-bench', Date.now());
    expect(res.status === 'ok' && res.draft.values).toEqual({ weight: '82,5', reps: '8' });
    expect(container.textContent).toContain('Entwurf auf diesem Gerät gespeichert');
  });

  it('restores the exact draft after the screen was left and shown again', () => {
    vi.useFakeTimers();
    render();
    type(input('weight'), '82,5');
    type(input('reps'), '8');
    act(() => vi.advanceTimersByTime(500));
    act(() => root.unmount());
    root = createRoot(container);
    render();
    expect(input('weight').value).toBe('82,5');
    expect(input('reps').value).toBe('8');
    expect(container.textContent).toContain('Entwurf wiederhergestellt – noch nicht gespeichert.');
  });

  it('a draft belongs to one exercise row: another row, workout or user never sees it', () => {
    vi.useFakeTimers();
    render();
    type(input('weight'), '82,5');
    act(() => vi.advanceTimersByTime(500));
    act(() => root.unmount());
    root = createRoot(container);
    render({ workoutExerciseId: 'we-OTHER' });
    expect(input('weight').value).toBe('');
    act(() => root.unmount());
    root = createRoot(container);
    render({ userId: 'someone-else' });
    expect(input('weight').value).toBe('');
  });

  it('is removed once the entry is saved, and can be discarded', async () => {
    vi.useFakeTimers();
    addSetAction.mockResolvedValue({ ok: true, setNumber: 1, replayed: false });
    render();
    type(input('weight'), '82,5');
    type(input('reps'), '8');
    act(() => vi.advanceTimersByTime(500));
    expect(readDraft(scope, 'ex-bench', Date.now()).status).toBe('ok');
    await submit();
    expect(readDraft(scope, 'ex-bench', Date.now()).status).toBe('none'); // gone at once, not only after the next debounce
    act(() => vi.advanceTimersByTime(500));
    expect(readDraft(scope, 'ex-bench', Date.now()).status).toBe('none');

    type(input('weight'), '99');
    act(() => vi.advanceTimersByTime(500));
    expect(readDraft(scope, 'ex-bench', Date.now()).status).toBe('ok');
    click(buttonByText('Entwurf verwerfen'));
    click(buttonByText('Wirklich verwerfen?')); // one tap asks, the second discards
    expect(readDraft(scope, 'ex-bench', Date.now()).status).toBe('none');
    expect(input('weight').value).toBe('82,5'); // back to the suggestion from the saved set
  });

  it('without usable storage the form keeps working and says restoring is unavailable', () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    render();
    type(input('weight'), '80');
    act(() => vi.advanceTimersByTime(500));
    expect(input('weight').value).toBe('80');
    expect(container.textContent).toContain('Lokale Wiederherstellung ist auf diesem Gerät nicht verfügbar');
    spy.mockRestore();
  });
});

describe('SetLogger — what the review found', () => {
  it('input typed while a save is still running is the next entry and is never replaced by the suggestion from the one just saved', async () => {
    let resolve!: (v: unknown) => void;
    addSetAction.mockReturnValue(new Promise((r) => (resolve = r)));
    render();
    type(input('weight'), '80');
    type(input('reps'), '10');
    await submit();
    // the inputs are still editable while the request is in flight
    type(input('weight'), '85');
    type(input('reps'), '8');
    await act(async () => {
      resolve({ ok: true, setNumber: 1, replayed: false });
      await Promise.resolve();
    });
    await flush();
    expect(input('weight').value).toBe('85');
    expect(input('reps').value).toBe('8');
    expect(submitButton().textContent).toContain('Satz 2 speichern'); // the number still moved, only after the server confirmed
    expect(container.textContent).toContain('Satz 1 gespeichert.');
  });

  it('…while an untouched form still gets the suggestion', async () => {
    addSetAction.mockResolvedValue({ ok: true, setNumber: 1, replayed: false });
    render();
    type(input('weight'), '80');
    type(input('reps'), '10');
    await submit();
    expect(input('weight').value).toBe('80');
  });

  it('the set number follows the saved list: after a set was deleted it goes back down', async () => {
    addSetAction.mockResolvedValue({ ok: true, setNumber: 4, replayed: false });
    render({ savedSets: [set(), set({ set_number: 2 }), set({ set_number: 3 })] });
    type(input('weight'), '80');
    type(input('reps'), '10');
    await submit();
    expect(submitButton().textContent).toContain('Satz 5 speichern'); // confirmed: 4 saved, the next is 5 (before the refreshed list arrives)
    render({ savedSets: [set(), set({ set_number: 2 }), set({ set_number: 3 }), set({ set_number: 4 })] });
    expect(submitButton().textContent).toContain('Satz 5 speichern');
    render({ savedSets: [set(), set({ set_number: 2 })] }); // two of them were deleted
    expect(submitButton().textContent).toContain('Satz 3 speichern');
  });

  it('a retry that carries different values than the first try says the stored entry kept the first ones', async () => {
    addSetAction.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ ok: true, setNumber: 1, replayed: true });
    render();
    type(input('weight'), '80');
    type(input('reps'), '10');
    await submit();
    type(input('weight'), '82,5'); // the user corrects the value and tries again
    await submit();
    expect(container.textContent).toContain('war schon mit den ursprünglichen Werten gespeichert');
    expect(container.textContent).toContain('deine Änderung wurde nicht übernommen');
  });

  it('a retry with the SAME values just says it was already stored', async () => {
    addSetAction.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ ok: true, setNumber: 1, replayed: true });
    render();
    type(input('weight'), '80');
    type(input('reps'), '10');
    await submit();
    await submit();
    expect(container.textContent).toContain('Dieser Eintrag war bereits gespeichert.');
    expect(container.textContent).not.toContain('Änderung wurde nicht übernommen');
  });

  it('a restored draft keeps its "wiederhergestellt" note and its time stamp — restoring is not an edit', () => {
    vi.useFakeTimers();
    render();
    type(input('weight'), '82,5');
    act(() => vi.advanceTimersByTime(500));
    act(() => root.unmount()); // leaving the screen flushes the draft one last time
    const key = storage.key(0)!;
    const stampedAt = JSON.parse(storage.getItem(key)!).t as number;
    root = createRoot(container);
    vi.setSystemTime(Date.now() + 3 * 3_600_000); // three hours later
    render();
    expect(container.textContent).toContain('Entwurf wiederhergestellt – noch nicht gespeichert.');
    act(() => vi.advanceTimersByTime(1000));
    expect(container.textContent).toContain('Entwurf wiederhergestellt – noch nicht gespeichert.'); // not flipped to "gespeichert"
    expect(JSON.parse(storage.getItem(key)!).t).toBe(stampedAt); // still the original stamp: the 24 h clock did not restart
    type(input('weight'), '90'); // a real edit is written again
    act(() => vi.advanceTimersByTime(500));
    expect(JSON.parse(storage.getItem(key)!).t).toBeGreaterThan(stampedAt);
  });

  it('a workout that was just ended gets no draft written back by its unmounting form', () => {
    vi.useFakeTimers();
    render();
    type(input('weight'), '82,5');
    markWorkoutEnded('workout-1'); // finish / skip / discard cleared everything and marked it
    storage.clear();
    act(() => root.unmount()); // the leave-the-screen flush
    expect(storage.length).toBe(0);
    root = createRoot(container);
  });

  it('"Entwurf verwerfen" asks once more before it costs typed input, and the question goes away by itself', () => {
    vi.useFakeTimers();
    render();
    type(input('weight'), '82,5');
    act(() => vi.advanceTimersByTime(500));
    click(buttonByText('Entwurf verwerfen'));
    expect(input('weight').value).toBe('82,5'); // one tap only asks
    expect(buttonByText('Wirklich verwerfen?')).toBeTruthy();
    act(() => vi.advanceTimersByTime(4500));
    expect(buttonByText('Entwurf verwerfen')).toBeTruthy(); // asked and forgotten
    click(buttonByText('Entwurf verwerfen'));
    click(buttonByText('Wirklich verwerfen?'));
    expect(input('weight').value).toBe('');
  });

  it('the save button stays focusable while a save runs (so focus is not lost) and a second tap does nothing', async () => {
    let resolve!: (v: unknown) => void;
    addSetAction.mockReturnValue(new Promise((r) => (resolve = r)));
    render();
    type(input('weight'), '80');
    type(input('reps'), '10');
    await submit();
    // never the `disabled` attribute (which would drop focus); the pending look is aria-disabled, which Next's React
    // sets while the action runs — the stable React used by these tests does not track async transitions.
    expect(submitButton().disabled).toBe(false);
    expect(submitButton().hasAttribute('aria-disabled')).toBe(true);
    await act(async () => {
      resolve({ ok: true, setNumber: 1, replayed: false });
      await Promise.resolve();
    });
    await flush();
    expect(submitButton().disabled).toBe(false);
  });

  it('the question about replacing typed input starts on the safe answer', () => {
    render({ lastResult: last([{ weight_kg: 80, reps: 10 }]) });
    type(input('weight'), '92,5');
    click(buttonByText('Werte übernehmen'));
    expect(document.activeElement).toBe(buttonByText('Behalten'));
  });
});

