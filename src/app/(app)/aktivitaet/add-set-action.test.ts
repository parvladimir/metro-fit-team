import { beforeEach, describe, expect, it, vi } from 'vitest';

const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/data/profile', () => ({
  requireAuthUser: async () => ({ id: 'user-1' }),
  getCurrentProfile: async () => null,
  getPrimaryTeamMembership: async () => null,
}));
vi.mock('@/lib/data/weekly-recap', () => ({ refreshWeeklyRecapIfExists: vi.fn() }));

interface Script {
  /** What the workout_exercises lookup returns (null = not visible / not there). */
  exercise: { workout_id: string; exercises: { exercise_type: string }; workouts: { status: string } | null } | null;
  /** Sets already stored for the exercise. */
  count: number;
  insertError: { code?: string } | null;
  /** The row a duplicate-key lookup finds. */
  existing: { set_number: number; workout_exercise_id: string } | null;
}
let script: Script;
const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];

function fakeClient() {
  return {
    from(table: string) {
      const q: Record<string, unknown> & { _head?: boolean } = {};
      q.select = (_cols?: string, opts?: { head?: boolean }) => {
        q._head = !!opts?.head;
        return q;
      };
      q.eq = () => q;
      q.maybeSingle = async () => ({ data: table === 'workout_exercises' ? script.exercise : script.existing });
      q.insert = async (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        return { error: script.insertError };
      };
      q.then = (resolve: (v: unknown) => void) => resolve({ count: script.count });
      return q;
    },
  };
}
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fakeClient() }));

import { addSetAction } from './actions';

const WE = '11111111-1111-4111-8111-111111111111';
const SUB = '22222222-2222-4222-8222-222222222222';
const WORKOUT = '33333333-3333-4333-8333-333333333333';

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
const strength = (extra: Record<string, string> = {}) => form({ workoutExerciseId: WE, submissionId: SUB, weight: '80', reps: '10', ...extra });

beforeEach(() => {
  revalidatePath.mockReset();
  inserts.length = 0;
  script = { exercise: { workout_id: WORKOUT, exercises: { exercise_type: 'strength' }, workouts: { status: 'laeuft' } }, count: 2, insertError: null, existing: null };
});

describe('addSetAction — one entry, stored once', () => {
  it('stores the entry under the id the client chose, as the next set number', async () => {
    const res = await addSetAction(strength());
    expect(res).toEqual({ ok: true, setNumber: 3, replayed: false });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.table).toBe('workout_sets');
    expect(inserts[0]!.row).toMatchObject({ id: SUB, workout_exercise_id: WE, set_number: 3, weight_kg: 80, reps: 10 });
  });

  it('answers a repeat of the same entry from the stored one instead of writing it again', async () => {
    script.insertError = { code: '23505' };
    script.existing = { set_number: 3, workout_exercise_id: WE };
    const res = await addSetAction(strength());
    expect(res).toEqual({ ok: true, setNumber: 3, replayed: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/aktivitaet/training/${WORKOUT}`);
  });

  it('does not accept an id that belongs to some other exercise (or to someone else)', async () => {
    script.insertError = { code: '23505' };
    script.existing = { set_number: 1, workout_exercise_id: '44444444-4444-4444-8444-444444444444' };
    expect(await addSetAction(strength())).toEqual({ ok: false, error: 'Eintrag konnte nicht gespeichert werden.' });
    script.existing = null; // not even visible to this user
    expect(await addSetAction(strength())).toEqual({ ok: false, error: 'Eintrag konnte nicht gespeichert werden.' });
  });

  it('says so when the exercise disappeared while saving (it was replaced)', async () => {
    script.insertError = { code: '23503' };
    const res = await addSetAction(strength());
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toContain('nicht mehr');
  });
});

describe('addSetAction — what it trusts', () => {
  it('refuses malformed ids before touching the database', async () => {
    expect(await addSetAction(form({ workoutExerciseId: 'nope', submissionId: SUB, weight: '80', reps: '10' }))).toMatchObject({ ok: false });
    expect(await addSetAction(form({ workoutExerciseId: WE, submissionId: 'nope', weight: '80', reps: '10' }))).toMatchObject({ ok: false });
    expect(inserts).toHaveLength(0);
  });

  it('refuses an exercise the caller cannot see', async () => {
    script.exercise = null;
    expect(await addSetAction(strength())).toMatchObject({ ok: false });
    expect(inserts).toHaveLength(0);
  });

  it('refuses to log into a workout that is not running any more', async () => {
    for (const status of ['abgeschlossen', 'uebersprungen', 'geplant']) {
      script.exercise = { workout_id: WORKOUT, exercises: { exercise_type: 'strength' }, workouts: { status } };
      expect(await addSetAction(strength()), status).toEqual({ ok: false, error: 'Dieses Training ist bereits beendet.' });
    }
    expect(inserts).toHaveLength(0);
  });

  it('takes the workout from the database row, never from a form field', async () => {
    await addSetAction(strength({ workoutId: '55555555-5555-4555-8555-555555555555' }));
    expect(revalidatePath).toHaveBeenCalledWith(`/aktivitaet/training/${WORKOUT}`);
  });
});

describe('addSetAction — validation per type is unchanged', () => {
  it('accepts a German decimal comma', async () => {
    await addSetAction(strength({ weight: '82,5' }));
    expect(inserts[0]!.row.weight_kg).toBe(82.5);
  });

  it('strength needs weight and repetitions; a zero is a value, an empty field is not', async () => {
    expect(await addSetAction(form({ workoutExerciseId: WE, submissionId: SUB, reps: '10' }))).toEqual({ ok: false, error: 'Gewicht und Wiederholungen sind nötig.' });
    expect(await addSetAction(strength({ weight: '0' }))).toMatchObject({ ok: true });
    expect(inserts[0]!.row.weight_kg).toBe(0);
  });

  it('rejects out-of-range and non-numeric input', async () => {
    expect(await addSetAction(strength({ weight: '99999' }))).toEqual({ ok: false, error: 'Bitte prüfe deine Eingaben.' });
    expect(await addSetAction(strength({ reps: 'abc' }))).toEqual({ ok: false, error: 'Bitte prüfe deine Eingaben.' });
    expect(inserts).toHaveLength(0);
  });

  it('puts RPE and rest into the metrics and trims the note', async () => {
    await addSetAction(strength({ rpe: '8', restSeconds: '90', notes: '  schwer  ' }));
    expect(inserts[0]!.row).toMatchObject({ metrics: { rpe: 8, rest_seconds: 90 }, notes: 'schwer' });
  });

  it('distance cardio keeps time and distance and accepts a time as mm:ss', async () => {
    script.exercise = { workout_id: WORKOUT, exercises: { exercise_type: 'cardio' }, workouts: { status: 'laeuft' } }; // legacy type
    await addSetAction(form({ workoutExerciseId: WE, submissionId: SUB, duration: '30:00', distanceKm: '5,2' }));
    expect(inserts[0]!.row).toMatchObject({ duration_seconds: 1800, distance_km: 5.2 });
  });

  it('an interval gets its duration from rounds × (work + rest) when none is given', async () => {
    script.exercise = { workout_id: WORKOUT, exercises: { exercise_type: 'interval' }, workouts: { status: 'laeuft' } };
    await addSetAction(form({ workoutExerciseId: WE, submissionId: SUB, rounds: '8', workSeconds: '40', intervalRestSeconds: '20' }));
    expect(inserts[0]!.row).toMatchObject({ duration_seconds: 480, metrics: { rounds: 8, work_seconds: 40, interval_rest_seconds: 20 } });
  });
});

describe('addSetAction — screens opened before this version', () => {
  it('a workout tab from before the update still calls it as (previousState, formData) and still saves', async () => {
    const legacy = form({ workoutExerciseId: WE, weight: '80', reps: '10', workoutId: 'ignored' }); // no entry id in the old form
    const res = await addSetAction(undefined, legacy);
    expect(res).toMatchObject({ ok: true, setNumber: 3, replayed: false });
    expect(String(inserts[0]!.row.id)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i); // the server makes one
    // the old client reads `ok` (truthy) and `error`: both are still there
    expect(res.ok).toBe(true);
    expect(await addSetAction(undefined, form({ workoutExerciseId: WE, reps: '10' }))).toMatchObject({ ok: false, error: 'Gewicht und Wiederholungen sind nötig.' });
  });

  it('a current client without an entry id is refused — only an old one is allowed to omit it', async () => {
    expect(await addSetAction(form({ workoutExerciseId: WE, weight: '80', reps: '10' }))).toMatchObject({ ok: false });
    expect(inserts).toHaveLength(0);
  });

  it('anything that is not a form is refused', async () => {
    expect(await addSetAction({ weight: '80' })).toMatchObject({ ok: false });
    expect(await addSetAction(undefined, 'nope')).toMatchObject({ ok: false });
  });
});

describe('addSetAction — a retry that arrives after the workout was finished', () => {
  it('answers "already saved" when this very entry is stored, instead of claiming the workout ended', async () => {
    script.exercise = { workout_id: WORKOUT, exercises: { exercise_type: 'strength' }, workouts: { status: 'abgeschlossen' } };
    script.existing = { set_number: 3, workout_exercise_id: WE };
    expect(await addSetAction(strength())).toEqual({ ok: true, setNumber: 3, replayed: true });
    expect(inserts).toHaveLength(0);
  });

  it('but another exercise\'s set with that id does not count, and an unknown entry is still refused', async () => {
    script.exercise = { workout_id: WORKOUT, exercises: { exercise_type: 'strength' }, workouts: { status: 'abgeschlossen' } };
    script.existing = { set_number: 3, workout_exercise_id: '44444444-4444-4444-8444-444444444444' };
    expect(await addSetAction(strength())).toEqual({ ok: false, error: 'Dieses Training ist bereits beendet.' });
    script.existing = null;
    expect(await addSetAction(strength())).toEqual({ ok: false, error: 'Dieses Training ist bereits beendet.' });
  });
});

