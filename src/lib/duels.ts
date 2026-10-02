/** Pure Freundschaftsduell logic — lifecycle phase, the seven-day window,
 * outcome wording, input validation and error text. No I/O, so it is plain-
 * import unit-testable and safe to use from both server and client code.
 *
 * Product rules this encodes (the database enforces the same ones; these
 * exist for early, friendly feedback and for rendering):
 *  - a duel is optional, private to exactly two members, and never affects
 *    points, ranking or the team feed;
 *  - it runs on seven Berlin calendar dates, always starts in the future and
 *    can never start retroactively;
 *  - the goal is 1–7 training days, frozen once created;
 *  - there is no winner: if both reach the goal it is a shared success, if
 *    one does the wording honours that person without comparing, and if
 *    neither does it simply reports honest progress. Speed never matters. */

import { addDaysToKey, formatDayKeyShort, localDayKey, localTimeString } from '@/lib/date';

export type DuelStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
export type DuelPhase = 'pending' | 'expired' | 'upcoming' | 'active' | 'finished' | 'declined' | 'cancelled';

export const DUEL_TARGET_MIN = 1;
export const DUEL_TARGET_MAX = 7;
export const DUEL_TARGET_DEFAULT = 3;
export const DUEL_LENGTH_DAYS = 7;
/** The latest start the database accepts, in days from today. */
export const DUEL_MAX_START_LEAD_DAYS = 14;
/** What the proposal form pre-selects. An invitation lapses when the duel
 * would start (and after three days at the latest), so a start three days out
 * leaves the invitee the rest of today plus two more full days to answer. */
export const DUEL_DEFAULT_START_LEAD_DAYS = 3;

export interface DuelTerms {
  status: DuelStatus;
  starts_on: string;
  ends_on: string;
  expires_at: string;
}

/** Where a duel is in its life at `now`. A pending invitation that has
 * outlived its expiry (or reached its start date) reads as `expired` even if
 * the row still says `pending` — the database only persists that the next
 * time anyone touches it, and the UI must not offer "Annehmen" for it. */
export function duelPhase(duel: DuelTerms, now: Date = new Date()): DuelPhase {
  switch (duel.status) {
    case 'declined':
    case 'cancelled':
    case 'expired':
      return duel.status;
    case 'pending': {
      const stale = new Date(duel.expires_at).getTime() <= now.getTime() || localDayKey(now) >= duel.starts_on;
      return stale ? 'expired' : 'pending';
    }
    case 'accepted': {
      const today = localDayKey(now);
      if (today < duel.starts_on) return 'upcoming';
      return today <= duel.ends_on ? 'active' : 'finished';
    }
  }
}

/** The seven Berlin calendar dates of a duel starting on `startsOn`. */
export function duelWindow(startsOn: string): { startsOn: string; endsOn: string; days: string[] } {
  const days = Array.from({ length: DUEL_LENGTH_DAYS }, (_, i) => addDaysToKey(startsOn, i));
  return { startsOn, endsOn: days[DUEL_LENGTH_DAYS - 1]!, days };
}

/** "Mo., 05.10. – So., 11.10." */
export function formatDuelRange(startsOn: string, endsOn: string): string {
  return `${formatDayKeyShort(startsOn)} – ${formatDayKeyShort(endsOn)}`;
}

/** Whole calendar days from `fromKey` to `toKey` (both YYYY-MM-DD); negative
 * when `toKey` is earlier. Pure date arithmetic — a daylight-saving day is
 * still one day. */
export function daysBetweenKeys(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = toKey.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** Calendar days of an active duel still ahead, today included (0 once it is over). */
export function duelDaysLeft(endsOn: string, now: Date = new Date()): number {
  return Math.max(0, daysBetweenKeys(localDayKey(now), endsOn) + 1);
}

/** How long an invitation can still be answered, as a short German phrase. An
 * invitation that lapses at the start of the duel's first day is described as
 * "Ende" of the day before — "00:00 Uhr" would read like a day too late. */
export function formatReplyDeadline(expiresAt: string): string {
  const at = new Date(expiresAt);
  const day = localDayKey(at);
  const time = localTimeString(at);
  if (time === '00:00' || time === '24:00') return `Ende ${formatDayKeyShort(addDaysToKey(day, time === '24:00' ? 0 : -1))}`;
  return `${formatDayKeyShort(day)}, ${time} Uhr`;
}

export function trainingDaysLabel(n: number): string {
  return n === 1 ? '1 Trainingstag' : `${n} Trainingstage`;
}

export interface DuelPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/** A duel as the viewer sees it. `progress` holds capped training-day counts
 * once the duel is accepted, and is null before that (or when unreadable). */
export interface DuelView {
  id: string;
  teamId: string;
  status: DuelStatus;
  phase: DuelPhase;
  role: 'inviter' | 'invitee';
  targetDays: number;
  startsOn: string;
  endsOn: string;
  expiresAt: string;
  me: DuelPerson;
  other: DuelPerson;
  progress: { me: number; other: number } | null;
}

/** How long a finished duel stays on Home so its result is seen, in days. */
export const DUEL_RESULT_VISIBLE_DAYS = 3;

/** Which one duel Home should surface, if any — what needs the viewer most:
 * an invitation waiting for their answer, then a running duel, then one that
 * is about to start, then their own invitation still awaiting an answer, then
 * a duel that just finished (so its result is seen once). `duels` is expected
 * newest first; ties within a group keep that order. Expired, declined and
 * cancelled duels never surface on Home. */
export function pickHomeDuel(duels: DuelView[], now: Date = new Date()): DuelView | null {
  const today = localDayKey(now);
  const rank = (d: DuelView): number | null => {
    const phase = duelPhase(
      { status: d.status, starts_on: d.startsOn, ends_on: d.endsOn, expires_at: d.expiresAt },
      now,
    );
    if (phase === 'pending') return d.role === 'invitee' ? 0 : 3;
    if (phase === 'active') return 1;
    if (phase === 'upcoming') return 2;
    if (phase === 'finished') return today <= addDaysToKey(d.endsOn, DUEL_RESULT_VISIBLE_DAYS) ? 4 : null;
    return null;
  };
  let best: { duel: DuelView; rank: number } | null = null;
  for (const duel of duels) {
    const r = rank(duel);
    if (r !== null && (best === null || r < best.rank)) best = { duel, rank: r };
  }
  return best?.duel ?? null;
}

export interface DuelOutcome {
  kind: 'both' | 'one' | 'none';
  headline: string;
  detail: string;
}

/** What to say when a duel is over. Counts are capped at the target first, so
 * "reached" means exactly "got to the goal". There is deliberately no input
 * that could express who was faster, and the wording never frames a winner or
 * loser. */
export function duelOutcome(args: { target: number; me: { name: string; days: number }; other: { name: string; days: number } }): DuelOutcome {
  const { target } = args;
  const mine = Math.min(Math.max(args.me.days, 0), target);
  const theirs = Math.min(Math.max(args.other.days, 0), target);
  const iReached = mine >= target;
  const theyReached = theirs >= target;
  const goal = trainingDaysLabel(target);

  if (iReached && theyReached) {
    return { kind: 'both', headline: 'Beide haben das Ziel erreicht!', detail: `Ihr habt beide ${goal} geschafft — gemeinsam drangeblieben.` };
  }
  if (iReached) {
    return {
      kind: 'one',
      headline: 'Du hast dein Ziel erreicht!',
      detail: `${args.other.name} kam auf ${theirs} von ${target}. Danke, dass ihr es zusammen versucht habt.`,
    };
  }
  if (theyReached) {
    return {
      kind: 'one',
      headline: `${args.other.name} hat das Ziel erreicht.`,
      detail: `Du kamst auf ${mine} von ${target} Trainingstagen — jeder Trainingstag zählt.`,
    };
  }
  return {
    kind: 'none',
    headline: 'Das Duell ist beendet.',
    detail: `Du: ${mine} von ${target}, ${args.other.name}: ${theirs} von ${target} Trainingstagen. Jeder Trainingstag zählt — danke fürs Mitmachen.`,
  };
}

/** The lines of a duel card: "A vs. B", the goal, and each side's count. The
 * other person comes first so the viewer's own line reads last, as "Du". */
export function formatDuelLines(args: { myName: string; otherName: string; target: number; myDays: number; otherDays: number }) {
  const cap = (n: number) => Math.min(Math.max(n, 0), args.target);
  return {
    title: `${args.myName} vs. ${args.otherName}`,
    goal: `Ziel: ${trainingDaysLabel(args.target)}`,
    other: `${args.otherName}: ${cap(args.otherDays)} / ${args.target}`,
    me: `Du: ${cap(args.myDays)} / ${args.target}`,
  };
}

export type DuelErrorCode = 'invalid_invitee' | 'invalid_target_days' | 'invalid_start_date';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDayKey(value: string): boolean {
  const m = DAY_KEY_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === mo - 1 && check.getUTCDate() === d;
}

export type DuelInputResult =
  | { ok: true; value: { inviteeId: string; targetDays: number; startsOn: string } }
  | { ok: false; error: DuelErrorCode };

/** The same checks the database makes, so a mistake gets a precise message
 * without a round trip. The database stays the authority. */
export function validateDuelInput(input: { inviteeId: unknown; targetDays: unknown; startsOn: unknown }, now: Date = new Date()): DuelInputResult {
  const inviteeId = typeof input.inviteeId === 'string' ? input.inviteeId.trim() : '';
  if (!UUID_RE.test(inviteeId)) return { ok: false, error: 'invalid_invitee' };

  const targetDays = Number(input.targetDays);
  if (typeof input.targetDays === 'boolean' || input.targetDays === '' || input.targetDays == null || !Number.isInteger(targetDays) || targetDays < DUEL_TARGET_MIN || targetDays > DUEL_TARGET_MAX) {
    return { ok: false, error: 'invalid_target_days' };
  }

  const startsOn = typeof input.startsOn === 'string' ? input.startsOn.trim() : '';
  const today = localDayKey(now);
  if (!isRealDayKey(startsOn) || startsOn <= today || startsOn > addDaysToKey(today, DUEL_MAX_START_LEAD_DAYS)) {
    return { ok: false, error: 'invalid_start_date' };
  }
  return { ok: true, value: { inviteeId, targetDays, startsOn } };
}

/** German text for an error from the duel functions (matched by the error
 * code the database raises). `invitee_unavailable` is deliberately one vague
 * sentence: it covers "busy" and "not in this team" alike and never says why.
 * (A teammate can still infer "busy", since only current members are offered —
 * inherent in the one-open-duel rule; the other person, the terms and the
 * state of the duel stay hidden.) */
export function duelErrorText(message: string | null | undefined): string {
  const m = message ?? '';
  if (m.includes('invalid_start_date')) return `Der Start muss in der Zukunft liegen — frühestens morgen, höchstens ${DUEL_MAX_START_LEAD_DAYS} Tage im Voraus.`;
  if (m.includes('invalid_target_days')) return `Das Ziel muss zwischen ${DUEL_TARGET_MIN} und ${DUEL_TARGET_MAX} Trainingstagen liegen.`;
  if (m.includes('invalid_invitee')) return 'Bitte wähle ein Teammitglied aus.';
  if (m.includes('already_in_duel')) return 'Du hast schon ein offenes oder laufendes Duell. Beende es zuerst, dann kannst du ein neues starten.';
  if (m.includes('invitee_unavailable')) return 'Diese Person ist gerade nicht verfügbar. Versuche es später noch einmal oder wähle jemand anderen.';
  if (m.includes('not_a_team_member')) return 'Du bist in diesem Team nicht (mehr) Mitglied.';
  if (m.includes('duel_not_found')) return 'Dieses Duell gibt es nicht mehr.';
  return 'Das hat nicht geklappt. Bitte versuche es noch einmal.';
}
