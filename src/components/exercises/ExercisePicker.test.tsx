// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { defaultPickerTab, ExercisePicker, filterExercises, itemsForTab, normalizeSearch, type PickerExercise } from './ExercisePicker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ex = (id: string, name: string, over: Partial<PickerExercise> = {}): PickerExercise => ({ id, name, exercise_type: 'strength', muscle_group: 'chest', is_custom: false, ...over });
const items: PickerExercise[] = [
  ex('bench', 'Bankdrücken'),
  ex('incline', 'Schrägbankdrücken'),
  ex('squat', 'Kniebeugen', { muscle_group: 'legs' }),
  ex('mine', 'Mein Klimmzug', { muscle_group: 'back', is_custom: true }),
];

describe('picker logic', () => {
  it('searches without caring about case or umlauts', () => {
    expect(normalizeSearch('  Schrägbank ')).toBe('schragbank');
    expect(filterExercises(items, 'SCHRAGBANK').map((e) => e.id)).toEqual(['incline']);
    expect(filterExercises(items, '').length).toBe(4);
  });

  it('opens on favourites if there are any, else on recent ones, else on everything', () => {
    expect(defaultPickerTab(2, 5)).toBe('favorites');
    expect(defaultPickerTab(0, 5)).toBe('recent');
    expect(defaultPickerTab(0, 0)).toBe('all');
    expect(defaultPickerTab(null, null)).toBe('all');
    expect(defaultPickerTab(null, 3)).toBe('recent');
  });

  it('favourites by name, recent in the given order, and only exercises the picker was given', () => {
    expect(itemsForTab(items, 'favorites', new Set(['squat', 'bench', 'gone']), []).map((e) => e.id)).toEqual(['bench', 'squat']);
    expect(itemsForTab(items, 'recent', new Set(), ['squat', 'gone', 'bench']).map((e) => e.id)).toEqual(['squat', 'bench']);
    expect(itemsForTab(items, 'all', new Set(), []).length).toBe(4);
  });
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(props: Partial<Parameters<typeof ExercisePicker>[0]> = {}) {
  act(() => root.render(<ExercisePicker items={items} onPick={() => undefined} {...props} />));
}
const tabs = () => [...container.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
const selectedTab = () => tabs().find((t) => t.getAttribute('aria-selected') === 'true')?.textContent;
const rowNames = () => [...container.querySelectorAll('li')].map((li) => li.querySelector('button')?.firstElementChild?.firstElementChild?.textContent);
const click = (el: Element | null | undefined) => act(() => { (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
function search(value: string) {
  const input = container.querySelector('input[type="search"]') as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ExercisePicker tabs', () => {
  it('without favourites or recent data it is just the plain list — no tabs, no stars', () => {
    render();
    expect(tabs()).toHaveLength(0);
    expect(container.querySelector('[aria-pressed]')).toBeNull();
    expect(rowNames()).toEqual(['Mein Klimmzug', 'Bankdrücken', 'Schrägbankdrücken', 'Kniebeugen']); // own exercises first, then by muscle group
  });

  it('shows Favoriten · Zuletzt · Alle when everything is available and opens on the favourites', () => {
    render({ favorites: { ids: new Set(['bench']), onToggle: vi.fn() }, recentIds: ['squat'] });
    expect(tabs().map((t) => t.textContent)).toEqual(['Favoriten', 'Zuletzt', 'Alle']);
    expect(selectedTab()).toBe('Favoriten');
    expect(rowNames()).toEqual(['Bankdrücken']);
    click(tabs()[1]);
    expect(rowNames()).toEqual(['Kniebeugen']);
    click(tabs()[2]);
    expect(rowNames().length).toBe(4);
  });

  it('a missing feature hides its own tab only', () => {
    render({ favorites: null, recentIds: ['squat'] });
    expect(tabs().map((t) => t.textContent)).toEqual(['Zuletzt', 'Alle']);
    render({ favorites: { ids: new Set(), onToggle: vi.fn() }, recentIds: null });
    expect(tabs().map((t) => t.textContent)).toEqual(['Favoriten', 'Alle']);
  });

  it('empty tabs explain themselves', () => {
    render({ favorites: { ids: new Set(), onToggle: vi.fn() }, recentIds: [] });
    expect(selectedTab()).toBe('Alle'); // nothing to show first, so it opens on everything
    click(tabs()[0]);
    expect(container.textContent).toContain('Noch keine Favoriten. Markiere Übungen mit dem Stern.');
    click(tabs()[1]);
    expect(container.textContent).toContain('Noch keine zuletzt benutzten Übungen.');
  });

  it('searching looks through ALL exercises, so a favourite is never a dead end', () => {
    render({ favorites: { ids: new Set(['bench']), onToggle: vi.fn() }, recentIds: [] });
    expect(selectedTab()).toBe('Favoriten');
    search('kniebeug');
    expect(rowNames()).toEqual(['Kniebeugen']);
    expect(selectedTab()).toBe('Alle');
    search('');
    expect(selectedTab()).toBe('Favoriten');
  });
});

describe('ExercisePicker favourites', () => {
  it('a star per row with a clear label, pressed for favourites; tapping reports the NEW state', () => {
    const onToggle = vi.fn();
    render({ favorites: { ids: new Set(['bench']), onToggle }, recentIds: null });
    click(tabs()[1]); // Alle
    const star = (name: string) => container.querySelector(`button[aria-label$="${name}"]`) as HTMLButtonElement;
    expect(star('Bankdrücken').getAttribute('aria-label')).toBe('Aus Favoriten entfernen: Bankdrücken');
    expect(star('Bankdrücken').getAttribute('aria-pressed')).toBe('true');
    expect(star('Kniebeugen').getAttribute('aria-label')).toBe('Zu Favoriten hinzufügen: Kniebeugen');
    expect(star('Kniebeugen').getAttribute('aria-pressed')).toBe('false');
    click(star('Kniebeugen'));
    expect(onToggle).toHaveBeenLastCalledWith('squat', true);
    click(star('Bankdrücken'));
    expect(onToggle).toHaveBeenLastCalledWith('bench', false);
  });

  it('tapping the star does not pick the exercise, and the current exercise cannot be picked but can be starred', () => {
    const onPick = vi.fn();
    const onToggle = vi.fn();
    render({ onPick, disabledId: 'bench', favorites: { ids: new Set(), onToggle }, recentIds: null });
    click(tabs()[1]);
    click(container.querySelector('button[aria-label$="Kniebeugen"]'));
    expect(onPick).not.toHaveBeenCalled();
    const benchRow = [...container.querySelectorAll('li')].find((li) => li.textContent?.includes('Bankdrücken'))!;
    expect((benchRow.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    expect((benchRow.querySelector('button[aria-pressed]') as HTMLButtonElement).disabled).toBe(false);
    const squatRow = [...container.querySelectorAll('li')].find((li) => li.textContent?.includes('Kniebeugen'))!;
    click(squatRow.querySelector('button'));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'squat' }));
  });
});
