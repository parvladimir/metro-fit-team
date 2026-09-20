import { describe, expect, it } from 'vitest';
import {
  agoLabel,
  buildCoachMessage,
  computeStreakDays,
  dayPart,
  detectPersonalRecord,
  greetingFor,
  type CoachInput,
  type RecordSet,
} from './coach';

const base = (over: Partial<CoachInput> = {}): CoachInput => ({
  firstName: 'Volodymyr',
  weekly: { completed: 0, goal: 3, minutes: 0, points: 0 },
  totalWorkouts: 5,
  activeWorkout: null,
  today: null,
  challenge: null,
  streakDays: 0,
  rank: null,
  teamSize: 1,
  pointsToNextRank: null,
  justFinished: null,
  record: null,
  team: null,
  ...over,
});
// Wednesday 2026-09-16 19:30 local
const wed = new Date(2026, 8, 16, 19, 30);
const msg = (over: Partial<CoachInput>, at = wed) => buildCoachMessage(base(over), at, 'user-1');

describe('1. greeting by time of day, real first name', () => {
  it('morning / day / evening', () => {
    expect(greetingFor(dayPart(8), 'Volodymyr')).toBe('Guten Morgen, Volodymyr');
    expect(greetingFor(dayPart(14), 'Anna')).toBe('Hallo, Anna');
    expect(greetingFor(dayPart(21), 'Özcan')).toBe('Guten Abend, Özcan');
    expect(greetingFor(dayPart(2), 'X')).toBe('Guten Abend, X');
  });
  it('never hardcodes a name and falls back gracefully', () => {
    expect(greetingFor('day', '')).toBe('Hallo, du');
    expect(msg({ firstName: 'Mia' }).greeting).toBe('Guten Abend, Mia');
  });
});

describe('4. priority', () => {
  it('E. active workout beats everything (incl. planned today, goal, team)', () => {
    const m = msg({
      activeWorkout: { id: 'w1' },
      today: { planTitle: 'Beine', isRest: false, startHref: '/x', alreadyDone: false },
      team: { kind: 'workout_completed', firstName: 'Dennis', avatarUrl: null, at: wed.getTime() - 60000, weekCount: 2 },
    });
    expect(m.state).toBe('active');
    expect(m.line).toMatch(/Training läuft|wartet/);
    expect(m.cta).toEqual({ label: 'Training fortsetzen', href: '/aktivitaet/training/w1' });
  });

  it('F. workout planned today → names it, CTA starts it', () => {
    const m = msg({ today: { planTitle: 'Beine', isRest: false, startHref: '/aktivitaet/training/neu?planDayId=p1', alreadyDone: false } });
    expect(m.state).toBe('planned');
    expect(m.line).toContain('Beine');
    expect(m.cta?.href).toBe('/aktivitaet/training/neu?planDayId=p1');
    expect(m.cta?.label).toMatch(/starten/);
  });

  it('a plan already done today or a rest day is not "planned"', () => {
    expect(msg({ today: { planTitle: 'Beine', isRest: false, startHref: '/x', alreadyDone: true } }).state).not.toBe('planned');
    expect(msg({ today: { planTitle: '', isRest: true, startHref: '/x', alreadyDone: false } }).state).not.toBe('planned');
  });

  it('A. new user → first-training message, no fake progress', () => {
    const m = msg({ totalWorkouts: 0 });
    expect(m.state).toBe('new_user');
    expect(m.line).toMatch(/erste/);
    expect(m.cta?.label).toBe('Training starten');
    expect(JSON.stringify(m)).not.toMatch(/Minuten|Punkte|Serie/);
  });

  it('B. 0/3 workouts → starting motivation, no guilt', () => {
    const m = msg({});
    expect(['generic', 'team']).toContain(m.state);
    expect(m.line).not.toMatch(/fehlen|versäumt|noch nicht/i);
  });

  it('C. 2/3 → exactly one workout remaining', () => {
    const m = msg({ weekly: { completed: 2, goal: 3, minutes: 90, points: 240 } });
    expect(m.state).toBe('goal_almost');
    expect(m.line).toMatch(/1 Training|Ein Training|einen Schritt/);
    expect(m.cta?.label).toBe('Training starten');
  });

  it('1/3 → no invented numbers or undefined text', () => {
    const m = msg({ weekly: { completed: 1, goal: 3, minutes: 45, points: 140 } });
    expect([m.greeting, m.line, m.sub ?? '', m.headline ?? ''].join(' ')).not.toMatch(/undefined|NaN|null/);
  });

  it('D. 3/3 → goal completed with real week totals and progress CTA', () => {
    const m = msg({ weekly: { completed: 3, goal: 3, minutes: 146, points: 420 } });
    expect(m.state).toBe('goal_reached');
    expect(m.sub).toBe('3 von 3 Trainings · 146 Min. · 420 Punkte');
    expect(m.cta).toEqual({ label: 'Fortschritt ansehen', href: '/profil/fortschritt' });
    expect(m.accent).toBe('success');
  });

  it('I. active challenge → challenge context, violet accent, challenge CTA', () => {
    const m = msg({ challenge: { percent: 80, remaining: 2, unit: 'km', completed: false } });
    expect(m.state).toBe('challenge');
    expect(m.line).toBe('Noch 2 km bis zum Challenge-Ziel.');
    expect(m.accent).toBe('challenge');
    expect(m.cta?.label).toBe('Challenge ansehen');
    expect(msg({ challenge: { percent: 95, remaining: 1, unit: null, completed: false } }).line).toBe('Challenge fast geschafft.');
    expect(msg({ challenge: { percent: 60, remaining: 0, unit: null, completed: false } }).line).toBe('Du hast 60 % der Challenge geschafft.');
  });

  it('a completed or barely started challenge is not shown', () => {
    expect(msg({ challenge: { percent: 100, remaining: 0, unit: null, completed: true } }).state).not.toBe('challenge');
    expect(msg({ challenge: { percent: 5, remaining: 8, unit: null, completed: false } }).state).not.toBe('challenge');
  });

  it('streak only when real (≥3 days)', () => {
    expect(msg({ streakDays: 3 }).state).toBe('streak');
    expect(msg({ streakDays: 3 }).line).toMatch(/3 Tage in Folge aktiv|Serie läuft/);
    expect(msg({ streakDays: 2 }).state).not.toBe('streak');
  });
});

describe('6/7/J/K/L. team motivation', () => {
  const ev = (over = {}) => ({ kind: 'workout_completed' as const, firstName: 'Dennis', avatarUrl: null, at: wed.getTime() - 18 * 60000, weekCount: 1, ...over });

  it('J. social motivation from a recent public event, friendly and non-comparative', () => {
    const m = msg({ team: ev() });
    expect(m.state).toBe('team');
    expect(m.line).toMatch(/Dennis war heute schon aktiv/);
    expect(JSON.stringify(m)).not.toMatch(/besser als du|schneller als du|vor dir|hinter/i);
  });

  it('weekly count and goal reached wording ties in the user\'s remaining workouts', () => {
    const goal = msg({ team: ev({ kind: 'goal_reached' }), weekly: { completed: 2, goal: 3, minutes: 90, points: 200 } });
    // 2/3 → goal_almost wins the line; the team shows as the compact row
    expect(goal.state).toBe('goal_almost');
    expect(goal.team).toMatchObject({ firstName: 'Dennis', what: 'Wochenziel erreicht', when: 'vor 18 Min.' });
    const cnt = msg({ team: ev({ weekCount: 3 }) });
    expect(cnt.line).toMatch(/Dennis/);
  });

  it('compact team row shows on top of another state (planned / almost goal), not as a second card', () => {
    const m = msg({
      today: { planTitle: 'Beine', isRest: false, startHref: '/x', alreadyDone: false },
      team: ev(),
    });
    expect(m.state).toBe('planned');
    expect(m.team).toEqual({ firstName: 'Dennis', avatarUrl: null, what: 'Training abgeschlossen', when: 'vor 18 Min.' });
  });

  it('K. no team activity → personal fallback, no team row', () => {
    const m = msg({});
    expect(m.team).toBeNull();
    expect(m.line.length).toBeGreaterThan(5);
    expect(m.cta).not.toBeNull();
  });

  it('L. private/opted-out activity never reaches the input, so nothing is shown', () => {
    // the data layer only reads opted-in feed rows; with no event the header stays personal
    expect(msg({ team: null }).team).toBeNull();
  });
});

describe('8/9. after-workout success and personal record', () => {
  it('G. success: title, minutes + points, goal hint', () => {
    const m = msg({ justFinished: { minutes: 42, points: 140 }, weekly: { completed: 2, goal: 3, minutes: 90, points: 240 } });
    expect(m.state).toBe('celebrate');
    expect(m.headline).toMatch(/Volodymyr/);
    expect(m.line).toBe('42 Min. Training · +140 Punkte');
    expect(m.sub).toMatch(/1 Training|Ein Training|einen Schritt/);
    expect(m.accent).toBe('success');
  });
  it('success without points omits them (no fake numbers)', () => {
    expect(msg({ justFinished: { minutes: 30, points: 0 } }).line).toBe('30 Min. Training');
  });
  it('H. record has higher priority than plain success and shows the real detail', () => {
    const m = msg({ justFinished: { minutes: 42, points: 140 }, record: { title: 'Neuer persönlicher Rekord! 🏆', detail: 'Bankdrücken · 90 kg' } });
    expect(m.state).toBe('record');
    expect(m.headline).toBe('Neuer persönlicher Rekord! 🏆');
    expect(m.line).toBe('Bankdrücken · 90 kg');
    expect(m.accent).toBe('gold');
  });
  it('a record without a just-finished workout is never shown', () => {
    expect(msg({ record: { title: 'x', detail: 'y' } }).state).not.toBe('record');
  });
});

describe('personal record detection (only real records)', () => {
  const s = (o: Partial<RecordSet>): RecordSet => ({ exerciseId: 'bank', exerciseName: 'Bankdrücken', kind: 'strength', weightKg: null, distanceKm: null, durationSeconds: null, ...o });
  it('heavier than every previous set', () => {
    expect(detectPersonalRecord([s({ weightKg: 90 })], [s({ weightKg: 80 }), s({ weightKg: 85 })])).toEqual({ title: 'Neuer persönlicher Rekord! 🏆', detail: 'Bankdrücken · 90 kg' });
  });
  it('equal or lighter is no record', () => {
    expect(detectPersonalRecord([s({ weightKg: 85 })], [s({ weightKg: 85 })])).toBeNull();
    expect(detectPersonalRecord([s({ weightKg: 70 })], [s({ weightKg: 85 })])).toBeNull();
  });
  it('the first time you ever do an exercise is not a record', () => {
    expect(detectPersonalRecord([s({ weightKg: 90 })], [])).toBeNull();
    expect(detectPersonalRecord([s({ weightKg: 90 })], [s({ exerciseId: 'other', weightKg: 20 })])).toBeNull();
  });
  it('faster pace over ≥1 km is a Bestzeit', () => {
    const run = (km: number, sec: number) => s({ exerciseId: 'run', exerciseName: 'Laufen', kind: 'distance', distanceKm: km, durationSeconds: sec });
    const r = detectPersonalRecord([run(5, 1500)], [run(5, 1650), run(8, 2900)]);
    expect(r?.title).toBe('Neue Bestzeit bei Laufen 🏆');
    expect(r?.detail).toBe('5:00 min/km');
    expect(detectPersonalRecord([run(5, 1800)], [run(5, 1650)])).toBeNull();
    expect(detectPersonalRecord([run(0.5, 100)], [run(5, 1650)])).toBeNull();
  });
});

describe('15/16. day-aware and variants', () => {
  const mon = new Date(2026, 8, 14, 9, 0);
  const fri = new Date(2026, 8, 18, 12, 0);
  const sun = new Date(2026, 8, 20, 12, 0);
  it('Monday with nothing done: fresh start, not guilt', () => {
    expect(buildCoachMessage(base(), mon, 'u').line).toBe('Neue Woche, neues Ziel.');
  });
  it('Friday / Sunday only when there is progress to complete', () => {
    const p = { weekly: { completed: 1, goal: 3, minutes: 30, points: 100 } };
    expect(buildCoachMessage(base(p), fri, 'u').line).toBe('Fast geschafft – wie sieht dein Wochenziel aus?');
    expect(buildCoachMessage(base(p), sun, 'u').line).toBe('Letzter Tag der Woche – fehlt dir noch ein Training?');
    expect(buildCoachMessage(base(), sun, 'u').line).not.toMatch(/Letzter Tag/);
  });
  it('messages vary between days but are stable within a time block', () => {
    const seen = new Set<string>();
    for (let d = 1; d <= 20; d++) seen.add(buildCoachMessage(base({ weekly: { completed: 2, goal: 3, minutes: 60, points: 200 } }), new Date(2026, 8, d, 12), 'u').line);
    expect(seen.size).toBeGreaterThan(1);
    const a = buildCoachMessage(base({ weekly: { completed: 2, goal: 3, minutes: 60, points: 200 } }), new Date(2026, 8, 16, 12, 5), 'u').line;
    const b = buildCoachMessage(base({ weekly: { completed: 2, goal: 3, minutes: 60, points: 200 } }), new Date(2026, 8, 16, 13, 50), 'u').line;
    expect(a).toBe(b);
  });
});

describe('streak + helpers', () => {
  it('counts consecutive days, tolerating "not yet today"', () => {
    expect(computeStreakDays(['2026-09-16', '2026-09-15', '2026-09-14'], '2026-09-16')).toBe(3);
    expect(computeStreakDays(['2026-09-15', '2026-09-14', '2026-09-13'], '2026-09-16')).toBe(3);
    expect(computeStreakDays(['2026-09-13'], '2026-09-16')).toBe(0);
    expect(computeStreakDays(['2026-09-16', '2026-09-14'], '2026-09-16')).toBe(1);
  });
  it('relative time', () => {
    expect(agoLabel(20_000)).toBe('gerade eben');
    expect(agoLabel(18 * 60000)).toBe('vor 18 Min.');
    expect(agoLabel(3 * 3600000)).toBe('vor 3 Std.');
    expect(agoLabel(30 * 3600000)).toBe('gestern');
  });
  it('fallback always yields text and a CTA', () => {
    const m = msg({ totalWorkouts: 9 });
    expect(m.greeting).toBeTruthy();
    expect(m.line).toBeTruthy();
    expect(m.cta).not.toBeNull();
  });
});
