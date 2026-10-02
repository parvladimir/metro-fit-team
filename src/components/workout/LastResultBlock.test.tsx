// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LastResultBlock } from './LastResultBlock';
import type { LastResultState } from '@/lib/exercise-history';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const entry = (n: number): LastResultState => ({
  status: 'ok',
  entry: {
    workoutId: 'w',
    workoutExerciseId: 'we',
    performedAt: '2026-09-27T16:00:00Z',
    instanceNo: 1,
    instanceCount: 1,
    sets: Array.from({ length: n }, (_, i) => ({ set_number: i + 1, weight_kg: 80, reps: 10 - i, distance_km: null, duration_seconds: null, metrics: {} })),
  },
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

function render(state: LastResultState, props: Partial<Parameters<typeof LastResultBlock>[0]> = {}) {
  act(() =>
    root.render(<LastResultBlock type="strength" exerciseName="Bankdrücken" state={state} nextSetNumber={1} copiedIndex={null} onCopy={vi.fn()} onRetry={vi.fn()} {...props} />),
  );
}

describe('LastResultBlock', () => {
  it('many earlier sets wrap onto further rows instead of running out of the card, and every chip is a full touch target', () => {
    render(entry(9));
    const group = container.querySelector('[role="group"]') as HTMLElement;
    expect(group.className).toContain('flex-wrap');
    const chips = [...group.querySelectorAll('button')];
    expect(chips).toHaveLength(9);
    for (const chip of chips) expect(chip.className).toMatch(/min-h-\[44px\]/);
    for (const chip of chips) expect(chip.className).toMatch(/min-w-\[44px\]/);
  });

  it('a single earlier set has no chips; the default button says which set it takes once there are several', () => {
    render(entry(1));
    expect(container.querySelector('[role="group"]')).toBeNull();
    expect(container.textContent).toContain('Werte übernehmen');
    render(entry(3), { nextSetNumber: 2 });
    expect(container.textContent).toContain('Werte übernehmen (Satz 2)');
  });

  it('the earlier summary never shows one weight for all sets when they differ', () => {
    render({ status: 'ok', entry: { ...(entry(2) as Extract<LastResultState, { status: 'ok' }>).entry, sets: [{ set_number: 1, weight_kg: 80, reps: 10, distance_km: null, duration_seconds: null, metrics: {} }, { set_number: 2, weight_kg: 75, reps: 8, distance_km: null, duration_seconds: null, metrics: {} }] } });
    expect(container.textContent).toContain('80 kg × 10 · 75 kg × 8');
  });

  it('the history button only exists when the history function does', () => {
    render(entry(2));
    expect(container.querySelector('button[aria-label="Verlauf ansehen"]')).toBeNull();
    render(entry(2), { onHistory: vi.fn() });
    expect(container.querySelector('button[aria-label="Verlauf ansehen"]')).not.toBeNull();
  });
});
