/**
 * Startseite "coach" header: picks ONE relevant, friendly message from real
 * data using predefined German templates (no generated text, no invented
 * numbers). Pure and deterministic given the same input + seed, so it is fully
 * unit-testable. Privacy: it only ever receives data that is already safe to
 * show (own stats, opted-in team feed events, public points/rank).
 */

export type CoachAccent = 'spark' | 'success' | 'gold' | 'challenge';

export interface CoachTeamEvent {
  kind: 'goal_reached' | 'workout_completed';
  firstName: string;
  avatarUrl: string | null;
  /** epoch ms of the event */
  at: number;
  /** that person's completed workouts this week (from the public feed), if known */
  weekCount: number | null;
}

export interface CoachInput {
  firstName: string;
  weekly: { completed: number; goal: number; minutes: number; points: number };
  totalWorkouts: number;
  activeWorkout: { id: string } | null;
  today: { planTitle: string; isRest: boolean; startHref: string; alreadyDone: boolean } | null;
  challenge: { percent: number; remaining: number; unit: string | null; completed: boolean } | null;
  streakDays: number;
  rank: number | null;
  teamSize: number;
  pointsToNextRank: number | null;
  justFinished: { minutes: number; points: number } | null;
  record: { title: string; detail: string } | null;
  team: CoachTeamEvent | null;
}

export interface CoachMessage {
  state:
    | 'record'
    | 'celebrate'
    | 'active'
    | 'planned'
    | 'new_user'
    | 'goal_almost'
    | 'goal_reached'
    | 'challenge'
    | 'streak'
    | 'team'
    | 'generic';
  accent: CoachAccent;
  greeting: string;
  /** big celebratory title shown instead of the plain line (success / record) */
  headline: string | null;
  line: string;
  sub: string | null;
  /** compact team row (avatar + who did what + when) */
  team: { firstName: string; avatarUrl: string | null; what: string; when: string } | null;
  cta: { label: string; href: string } | null;
}

export type DayPart = 'morning' | 'day' | 'evening';

export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 18 || hour < 5) return 'evening';
  return 'day';
}

export function greetingFor(part: DayPart, firstName: string): string {
  const name = firstName.trim() || 'du';
  if (part === 'morning') return `Guten Morgen, ${name}`;
  if (part === 'evening') return `Guten Abend, ${name}`;
  return `Hallo, ${name}`;
}

/** Stable pseudo-random pick: same seed → same variant, different days/blocks vary. */
export function pick<T>(variants: readonly T[], seed: number): T {
  return variants[Math.abs(seed) % variants.length]!;
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function agoLabel(ms: number): string {
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  return 'gestern';
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Consecutive days with a completed workout, counting back from today (or
 * yesterday, so a streak is not "lost" before the day is over). Dates are YYYY-MM-DD. */
export function computeStreakDays(finishedDates: string[], today: string): number {
  const set = new Set(finishedDates);
  const day = (d: string, delta: number) => {
    const t = new Date(`${d}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() + delta);
    return t.toISOString().slice(0, 10);
  };
  let cursor = set.has(today) ? today : set.has(day(today, -1)) ? day(today, -1) : null;
  if (!cursor) return 0;
  let n = 0;
  while (set.has(cursor)) {
    n += 1;
    cursor = day(cursor, -1);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Personal records (real, computed — never invented)
// ---------------------------------------------------------------------------
export interface RecordSet {
  exerciseId: string;
  exerciseName: string;
  kind: 'strength' | 'distance';
  weightKg: number | null;
  distanceKm: number | null;
  durationSeconds: number | null;
}

export function paceOf(s: { distanceKm: number | null; durationSeconds: number | null }): number | null {
  return s.distanceKm && s.distanceKm >= 1 && s.durationSeconds ? s.durationSeconds / s.distanceKm : null;
}

/** A record needs history: the first time you ever do an exercise is not a
 * "new" record. Strength: heavier than every previous set of that exercise.
 * Distance: faster pace (≥1 km) than every previous effort. */
export function detectPersonalRecord(current: RecordSet[], previous: RecordSet[]): { title: string; detail: string } | null {
  for (const cur of current) {
    const prev = previous.filter((p) => p.exerciseId === cur.exerciseId && p.kind === cur.kind);
    if (prev.length === 0) continue;
    if (cur.kind === 'strength' && cur.weightKg) {
      const best = Math.max(...prev.map((p) => p.weightKg ?? 0));
      const now = Math.max(...current.filter((c) => c.exerciseId === cur.exerciseId).map((c) => c.weightKg ?? 0));
      if (now > best && best > 0) {
        return { title: 'Neuer persönlicher Rekord! 🏆', detail: `${cur.exerciseName} · ${now.toLocaleString('de-DE', { maximumFractionDigits: 2 })} kg` };
      }
    }
    if (cur.kind === 'distance') {
      const pace = paceOf(cur);
      const prevPaces = prev.map(paceOf).filter((x): x is number => x !== null);
      if (pace && prevPaces.length && pace < Math.min(...prevPaces)) {
        return { title: `Neue Bestzeit bei ${cur.exerciseName} 🏆`, detail: `${Math.floor(pace / 60)}:${String(Math.round(pace % 60)).padStart(2, '0')} min/km` };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Message building
// ---------------------------------------------------------------------------
const TRAIN = '/aktivitaet/training/neu';

/** `now` supplies wall-clock parts (hour, weekday, date); `nowMs` the real instant for "vor 18 Min.". */
export function buildCoachMessage(input: CoachInput, now: Date, userSeed: string, nowMs: number = now.getTime()): CoachMessage {
  const part = dayPart(now.getHours());
  const greeting = greetingFor(part, input.firstName);
  const seed = hashSeed(`${userSeed}|${now.toISOString().slice(0, 10)}|${Math.floor(now.getHours() / 4)}`);
  const { completed, goal } = input.weekly;
  const remaining = Math.max(0, goal - completed);
  const goalReached = goal > 0 && completed >= goal;
  const weekday = now.getDay(); // 0 = Sonntag
  const first = input.firstName.trim() || 'du';

  const base = { greeting, headline: null, sub: null, team: null, cta: null } as const;

  const goalSub = goalReached
    ? pick(['Wochenziel geschafft! 🏆', 'Ziel erreicht – starke Woche.'], seed)
    : remaining === 1
      ? pick(['Nur noch 1 Training bis zum Wochenziel.', 'Ein Training fehlt dir noch diese Woche.', 'Du bist nur noch einen Schritt vom Wochenziel entfernt.'], seed)
      : remaining > 1 && completed > 0
        ? pick([`Dir fehlen noch ${remaining} Trainings bis zu deinem Wochenziel.`, `Noch ${remaining} Trainings bis zum Wochenziel.`], seed)
        : null;

  // ---- 0. celebrations (right after a workout) ----
  if (input.record && input.justFinished) {
    return { ...base, state: 'record', accent: 'gold', headline: input.record.title, line: input.record.detail, sub: goalSub, cta: { label: 'Fortschritt ansehen', href: '/profil/fortschritt' } };
  }
  if (input.justFinished) {
    const j = input.justFinished;
    const headline = pick([`Stark gemacht, ${first}! 🔥`, `Das war stark, ${first}! 🔥`, `Sauber, ${first} – Training im Kasten. 💪`], seed);
    const line = `${j.minutes} Min. Training${j.points > 0 ? ` · +${j.points} Punkte` : ''}`;
    return { ...base, state: 'celebrate', accent: 'success', headline, line, sub: goalSub, cta: goalReached ? { label: 'Fortschritt ansehen', href: '/profil/fortschritt' } : null };
  }

  // ---- 1. active workout ----
  if (input.activeWorkout) {
    return {
      ...base,
      state: 'active',
      accent: 'spark',
      line: pick(['Dein Training läuft noch.', 'Dein Training wartet auf dich – weiter geht’s.'], seed),
      cta: { label: 'Training fortsetzen', href: `/aktivitaet/training/${input.activeWorkout.id}` },
    };
  }

  const teamRow = input.team ? teamRowFor(input.team, nowMs) : null;

  // ---- 2. workout planned today ----
  if (input.today && !input.today.isRest && !input.today.alreadyDone) {
    const title = input.today.planTitle;
    return {
      ...base,
      state: 'planned',
      accent: 'spark',
      line: title
        ? pick([`Heute steht ${title} auf deinem Plan.`, `${title} wartet heute auf dich.`, `Heute auf dem Plan: ${title}.`], seed)
        : 'Dein Training für heute ist geplant.',
      sub: remaining === 1 ? goalSub : null,
      team: teamRow,
      cta: { label: pick(['Heutiges Training starten', 'Training starten'], seed), href: input.today.startHref },
    };
  }

  // ---- new user ----
  if (input.totalWorkouts === 0 && completed === 0) {
    return {
      ...base,
      state: 'new_user',
      accent: 'spark',
      line: pick(['Bereit für dein erstes Training?', 'Starte heute mit deinem ersten Schritt.'], seed),
      cta: { label: 'Training starten', href: TRAIN },
      team: teamRow,
    };
  }

  // ---- 3. weekly goal almost reached ----
  if (!goalReached && remaining === 1 && completed > 0) {
    return {
      ...base,
      state: 'goal_almost',
      accent: 'spark',
      line: goalSub!,
      team: teamRow,
      cta: { label: 'Training starten', href: TRAIN },
    };
  }

  // ---- 4. weekly goal reached ----
  if (goalReached) {
    return {
      ...base,
      state: 'goal_reached',
      accent: 'success',
      line: goalSub!,
      sub: `${completed} von ${goal} Trainings · ${input.weekly.minutes} Min. · ${input.weekly.points} Punkte`,
      cta: { label: 'Fortschritt ansehen', href: '/profil/fortschritt' },
    };
  }

  // ---- 5. active challenge ----
  if (input.challenge && !input.challenge.completed) {
    const c = input.challenge;
    const pct = Math.round(c.percent);
    let line: string | null = null;
    if (c.percent >= 90) line = 'Challenge fast geschafft.';
    else if (c.remaining > 0 && c.unit) line = `Noch ${formatNumber(c.remaining)} ${c.unit} bis zum Challenge-Ziel.`;
    else if (pct >= 40) line = `Du hast ${pct} % der Challenge geschafft.`;
    if (line) return { ...base, state: 'challenge', accent: 'challenge', line, team: null, cta: { label: 'Challenge ansehen', href: '/team/herausforderungen' } };
  }

  // ---- 6a. streak ----
  if (input.streakDays >= 3) {
    return {
      ...base,
      state: 'streak',
      accent: 'spark',
      line: pick([`${input.streakDays} Tage in Folge aktiv 🔥`, 'Deine Serie läuft – weiter so.'], seed),
      sub: goalSub,
      cta: { label: 'Training starten', href: TRAIN },
    };
  }

  // ---- 6b. friendly team activity ----
  if (input.team) {
    const t = input.team;
    return {
      ...base,
      state: 'team',
      accent: 'spark',
      line: teamSentence(t, remaining, completed, seed),
      cta: { label: input.today?.isRest ? 'Plan ansehen' : 'Training starten', href: input.today?.isRest ? '/plan' : TRAIN },
    };
  }

  // ---- 7. generic / day-aware ----
  let line: string;
  if (completed === 0 && weekday === 1) line = 'Neue Woche, neues Ziel.';
  else if (remaining > 0 && completed > 0 && weekday === 5) line = 'Fast geschafft – wie sieht dein Wochenziel aus?';
  else if (remaining > 0 && completed > 0 && weekday === 0) line = 'Letzter Tag der Woche – fehlt dir noch ein Training?';
  else if (input.rank && input.teamSize > 1 && input.weekly.points > 0 && seed % 3 === 0)
    line = input.pointsToNextRank && input.pointsToNextRank > 0 ? `Nur ${input.pointsToNextRank} Punkte bis zum nächsten Platz.` : `Du bist aktuell auf Platz ${input.rank} im Team.`;
  else if (completed > 0 && input.weekly.minutes > 0) line = `Diese Woche hast du bereits ${input.weekly.minutes} Minuten trainiert.`;
  else line = pick(['Bereit für dein nächstes Training?', 'Dein nächstes Training wartet.', 'Heute ist ein guter Tag für Bewegung.'], seed);
  return {
    ...base,
    state: 'generic',
    accent: 'spark',
    line,
    cta: input.today?.isRest ? { label: 'Plan ansehen', href: '/plan' } : { label: 'Training starten', href: TRAIN },
  };
}

function formatNumber(n: number): string {
  return n.toLocaleString('de-DE', { maximumFractionDigits: 1 });
}

function teamRowFor(t: CoachTeamEvent, nowMs: number): CoachMessage['team'] {
  return {
    firstName: t.firstName,
    avatarUrl: t.avatarUrl,
    what: t.kind === 'goal_reached' ? 'Wochenziel erreicht' : 'Training abgeschlossen',
    when: agoLabel(nowMs - t.at),
  };
}

/** Friendly, never comparative: encourages, never ranks the user below someone. */
function teamSentence(t: CoachTeamEvent, remaining: number, completed: number, seed: number): string {
  const n = t.firstName;
  const fewLeft = remaining === 1 && completed > 0;
  if (t.kind === 'goal_reached') {
    return fewLeft ? `${n} hat das Wochenziel erreicht. Du bist auch fast da.` : pick([`${n} hat das Wochenziel erreicht. 🔥`, `${n} hat diese Woche schon alles geschafft – stark!`], seed);
  }
  if (t.weekCount && t.weekCount >= 2 && seed % 2 === 0) {
    const tail = remaining === 1 ? ' Dir fehlt noch eins bis zum Wochenziel.' : remaining > 1 && completed > 0 ? ` Dir fehlen noch ${remaining} bis zum Wochenziel.` : '';
    return `${n} hat diese Woche bereits ${t.weekCount} ${plural(t.weekCount, 'Training', 'Trainings')} geschafft.${tail}`;
  }
  return pick([`${n} war heute schon aktiv – bist du auch dabei?`, `${n} war heute schon aktiv. 💪`], seed);
}

/** Wall-clock parts in Europe/Berlin (the team's zone) for server-rendering the greeting. */
export function berlinWallClock(d: Date = new Date()): { y: number; m: number; day: number; h: number; min: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get('year'), m: get('month'), day: get('day'), h: get('hour') % 24, min: get('minute') };
}
