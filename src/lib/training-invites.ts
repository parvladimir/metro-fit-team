/** Pure "Wer ist dabei?" logic — the shape of an invitation card as one viewer
 * sees it, its state, how its time is worded, how typed input is cleaned and
 * how a wall-clock time that is ambiguous around a clock change is resolved.
 * No I/O: usable from the server loader, the realtime client and unit tests.
 *
 * What an invitation is NOT: a workout, an attendance record, a points event
 * or anything location-based. An answer ("Dabei" / "Vielleicht") is a
 * non-binding signal and the place is whatever the organizer typed. */

import {
  addDaysToKey,
  formatDayKeyShort,
  localDayKey,
  localTimeString,
  resolveLocalDateTime,
  type LocalDateTimeResolution,
} from '@/lib/date';

export type RsvpStatus = 'going' | 'maybe';

export const TRAINING_INVITE_ACTIVITY_TYPES = [
  'krafttraining', 'laufen', 'gehen', 'radfahren', 'schwimmen', 'cardio', 'fussball', 'fitnesskurs', 'sonstiges',
] as const;
export type TrainingInviteActivityType = (typeof TRAINING_INVITE_ACTIVITY_TYPES)[number];

export const TRAINING_INVITE_LIMITS = { title: 80, place: 80, note: 200, horizonDays: 90 } as const;

/** One select used by the server loader AND the realtime client, so a card
 * fetched live is shaped exactly like one rendered on page load. The answers
 * embed through the composite (invite_id, team_id) foreign key; row-level
 * security already hides answers of people who left the team. */
export const TRAINING_INVITE_SELECT =
  'id, message_id, team_id, organizer_id, title, starts_at, activity_type, place, note, plan_share_id, rsvp_version, cancelled_at, edited_at, created_at, ' +
  'organizer:profiles!training_invites_organizer_id_fkey(id, full_name, avatar_url), ' +
  'plan_share:plan_shares(id, title, withdrawn_at), ' +
  'training_invite_rsvps(user_id, status, profiles(full_name, avatar_url))';

interface ProfileEmbed {
  full_name: string | null;
  avatar_url: string | null;
}

export interface RawInviteRow {
  id: string;
  message_id: string;
  team_id: string;
  organizer_id: string;
  title: string;
  starts_at: string;
  activity_type: string | null;
  place: string | null;
  note: string | null;
  plan_share_id: string | null;
  rsvp_version: number;
  cancelled_at: string | null;
  edited_at: string | null;
  created_at: string;
  organizer: (ProfileEmbed & { id: string }) | null;
  plan_share: { id: string; title: string; withdrawn_at: string | null } | null;
  training_invite_rsvps: { user_id: string; status: RsvpStatus; profiles: ProfileEmbed | null }[];
}

export interface InviteParticipant {
  userId: string;
  name: string;
  avatarUrl: string | null;
  status: RsvpStatus;
}

/** An invitation as one viewer sees it. The viewer's own answer is kept apart
 * from everyone else's so an optimistic tap is never overwritten by a live
 * refresh that was already in flight. */
export interface TrainingInviteForViewer {
  id: string;
  messageId: string;
  teamId: string;
  organizerId: string;
  organizerName: string;
  organizerAvatar: string | null;
  title: string;
  startsAt: string;
  activityType: string | null;
  place: string | null;
  note: string | null;
  planShare: { id: string; title: string; withdrawnAt: string | null } | null;
  cancelledAt: string | null;
  editedAt: string | null;
  rsvpVersion: number;
  myStatus: RsvpStatus | null;
  others: InviteParticipant[];
}

export function toInviteForViewer(row: RawInviteRow, viewerId: string): TrainingInviteForViewer {
  const rsvps = row.training_invite_rsvps ?? [];
  const others = rsvps
    .filter((r) => r.user_id !== viewerId)
    .map((r) => ({
      userId: r.user_id,
      name: r.profiles?.full_name?.trim() || 'Teammitglied',
      avatarUrl: r.profiles?.avatar_url ?? null,
      status: r.status,
    }))
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name, 'de') : a.status === 'going' ? -1 : 1));
  return {
    id: row.id,
    messageId: row.message_id,
    teamId: row.team_id,
    organizerId: row.organizer_id,
    organizerName: row.organizer?.full_name?.trim() || 'Ein Teammitglied',
    organizerAvatar: row.organizer?.avatar_url ?? null,
    title: row.title,
    startsAt: row.starts_at,
    activityType: row.activity_type,
    place: row.place,
    note: row.note,
    planShare: row.plan_share ? { id: row.plan_share.id, title: row.plan_share.title, withdrawnAt: row.plan_share.withdrawn_at } : null,
    cancelledAt: row.cancelled_at,
    editedAt: row.edited_at,
    rsvpVersion: row.rsvp_version,
    myStatus: rsvps.find((r) => r.user_id === viewerId)?.status ?? null,
    others,
  };
}

export function inviteCounts(invite: Pick<TrainingInviteForViewer, 'myStatus' | 'others'>): { going: number; maybe: number } {
  const all = [...invite.others.map((o) => o.status), ...(invite.myStatus ? [invite.myStatus] : [])];
  return { going: all.filter((s) => s === 'going').length, maybe: all.filter((s) => s === 'maybe').length };
}

export function countsLabel(counts: { going: number; maybe: number }): string {
  if (counts.going === 0 && counts.maybe === 0) return 'Noch keine Antworten';
  const parts: string[] = [];
  if (counts.going > 0) parts.push(`${counts.going} dabei`);
  if (counts.maybe > 0) parts.push(`${counts.maybe} vielleicht`);
  return parts.join(' · ');
}

/** The viewer's own answer as a participant row, so the list can show "Du". */
export function inviteParticipants(invite: TrainingInviteForViewer): (InviteParticipant & { isMe: boolean })[] {
  const me: (InviteParticipant & { isMe: boolean })[] = invite.myStatus
    ? [{ userId: 'me', name: 'Du', avatarUrl: null, status: invite.myStatus, isMe: true }]
    : [];
  return [...me, ...invite.others.map((o) => ({ ...o, isMe: false }))];
}

export type InviteState = 'cancelled' | 'started' | 'upcoming';

export function inviteState(invite: Pick<TrainingInviteForViewer, 'cancelledAt' | 'startsAt'>, now: Date = new Date()): InviteState {
  if (invite.cancelledAt) return 'cancelled';
  return new Date(invite.startsAt).getTime() <= now.getTime() ? 'started' : 'upcoming';
}

/** Optimistic local update of the viewer's own answer. */
export function applyOwnRsvp(invite: TrainingInviteForViewer, status: RsvpStatus | null): TrainingInviteForViewer {
  return invite.myStatus === status ? invite : { ...invite, myStatus: status };
}

/** "Heute · 18:30", "Morgen · 07:00", "Sa., 03.10. · 10:00" — Berlin time.
 * During the one hour a year that occurs twice (clocks going back) the time
 * is suffixed with MESZ/MEZ, so "02:30" is never ambiguous on the card. */
export function formatInviteWhen(startsAt: string, now: Date = new Date()): string {
  const at = new Date(startsAt);
  const day = localDayKey(at);
  const today = localDayKey(now);
  const label = day === today ? 'Heute' : day === addDaysToKey(today, 1) ? 'Morgen' : formatDayKeyShort(day);
  let time = localTimeString(at);
  const resolved = resolveLocalDateTime(`${day}T${time}`);
  if (resolved.kind === 'ambiguous') time += at.getTime() === resolved.first.getTime() ? ' MESZ' : ' MEZ';
  return `${label} · ${time}`;
}

export type InviteErrorCode = 'invalid_title' | 'invalid_place' | 'invalid_note' | 'invalid_activity_type' | 'invalid_plan_share';

export type InviteInputResult =
  | { ok: true; value: { title: string; activityType: string | null; place: string | null; note: string | null; planShareId: string | null } }
  | { ok: false; error: InviteErrorCode };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Trims and bounds the typed fields exactly as the database does; empty
 * optional text becomes null. */
export function cleanInviteInput(raw: { title: unknown; activityType: unknown; place: unknown; note: unknown; planShareId: unknown }): InviteInputResult {
  const title = text(raw.title);
  if (title.length < 1 || title.length > TRAINING_INVITE_LIMITS.title) return { ok: false, error: 'invalid_title' };
  const place = text(raw.place) || null;
  if (place && place.length > TRAINING_INVITE_LIMITS.place) return { ok: false, error: 'invalid_place' };
  const note = text(raw.note) || null;
  if (note && note.length > TRAINING_INVITE_LIMITS.note) return { ok: false, error: 'invalid_note' };
  const activityType = text(raw.activityType) || null;
  if (activityType && !(TRAINING_INVITE_ACTIVITY_TYPES as readonly string[]).includes(activityType)) return { ok: false, error: 'invalid_activity_type' };
  const planShareId = text(raw.planShareId) || null;
  if (planShareId && !UUID_RE.test(planShareId)) return { ok: false, error: 'invalid_plan_share' };
  return { ok: true, value: { title, activityType, place, note, planShareId } };
}

export function inviteErrorText(message: string | null | undefined): string {
  const m = message ?? '';
  if (m.includes('invalid_title')) return `Bitte gib einen Titel an (höchstens ${TRAINING_INVITE_LIMITS.title} Zeichen).`;
  if (m.includes('invalid_place')) return `Der Treffpunkt darf höchstens ${TRAINING_INVITE_LIMITS.place} Zeichen lang sein.`;
  if (m.includes('invalid_note')) return `Die Notiz darf höchstens ${TRAINING_INVITE_LIMITS.note} Zeichen lang sein.`;
  if (m.includes('invalid_activity_type')) return 'Diese Trainingsart gibt es nicht.';
  if (m.includes('invalid_plan_share')) return 'Diese Vorlage ist nicht (mehr) verfügbar.';
  if (m.includes('invalid_start_time')) return `Der Zeitpunkt muss in der Zukunft liegen (höchstens ${TRAINING_INVITE_LIMITS.horizonDays} Tage im Voraus).`;
  if (m.includes('not_a_team_member')) return 'Du bist in diesem Team nicht (mehr) Mitglied.';
  if (m.includes('invite_not_found')) return 'Diese Einladung gibt es nicht mehr.';
  if (m.includes('invite_closed')) return 'Diese Einladung wurde abgesagt.';
  if (m.includes('invite_started')) return 'Das Training hat schon begonnen.';
  return 'Das hat nicht geklappt. Bitte versuche es noch einmal.';
}

/** A wall-clock time that needs the organizer's decision before it can be used. */
export interface TimeCheck {
  kind: 'gap' | 'ambiguous';
  /** The exact datetime-local value this check was raised for; the form only shows it while the field still holds it. */
  forValue: string;
  message: string;
  choices: { value: 'before' | 'after' | 'first' | 'second'; label: string }[];
}

export type InviteTimeResult =
  | { kind: 'ok'; instant: Date }
  | { kind: 'invalid' }
  | { kind: 'past' }
  | { kind: 'too_far' }
  | { kind: 'check'; check: TimeCheck };

function timeCheckFor(value: string, resolved: Extract<LocalDateTimeResolution, { kind: 'gap' | 'ambiguous' }>): TimeCheck {
  const [day, hhmm] = value.trim().split('T') as [string, string];
  if (resolved.kind === 'gap') {
    return {
      kind: 'gap',
      forValue: value,
      message: `Um ${hhmm} Uhr gibt es am ${formatDayKeyShort(day)} wegen der Zeitumstellung keine Uhrzeit. Welche Zeit meinst du?`,
      choices: [
        { value: 'before', label: `${localTimeString(resolved.before)} Uhr` },
        { value: 'after', label: `${localTimeString(resolved.after)} Uhr` },
      ],
    };
  }
  return {
    kind: 'ambiguous',
    forValue: value,
    message: `Um ${hhmm} Uhr gibt es am ${formatDayKeyShort(day)} zweimal (Zeitumstellung). Welche meinst du?`,
    choices: [
      { value: 'first', label: `${hhmm} Uhr (MESZ, Sommerzeit)` },
      { value: 'second', label: `${hhmm} Uhr (MEZ, Winterzeit)` },
    ],
  };
}

/** Turns what the organizer typed into an instant — or into the question the
 * form must ask. A time that does not exist, or that happens twice, is never
 * guessed: `choice` carries the organizer's pick from the previous round. */
export function resolveInviteTime(value: string, choice: string | null, now: Date = new Date()): InviteTimeResult {
  const resolved = resolveLocalDateTime(value);
  let instant: Date;
  if (resolved.kind === 'invalid') return { kind: 'invalid' };
  if (resolved.kind === 'ok') {
    instant = resolved.instant;
  } else if (resolved.kind === 'gap') {
    const picked = choice === 'before' ? resolved.before : choice === 'after' ? resolved.after : null;
    if (!picked) return { kind: 'check', check: timeCheckFor(value, resolved) };
    instant = picked;
  } else {
    const picked = choice === 'first' ? resolved.first : choice === 'second' ? resolved.second : null;
    if (!picked) return { kind: 'check', check: timeCheckFor(value, resolved) };
    instant = picked;
  }
  if (instant.getTime() <= now.getTime()) return { kind: 'past' };
  if (instant.getTime() > now.getTime() + TRAINING_INVITE_LIMITS.horizonDays * 86_400_000) return { kind: 'too_far' };
  return { kind: 'ok', instant };
}
