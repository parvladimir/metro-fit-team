import { describe, expect, it } from 'vitest';
import {
  applyOwnRsvp,
  cleanInviteInput,
  countsLabel,
  formatInviteWhen,
  inviteCounts,
  inviteErrorText,
  inviteParticipants,
  inviteState,
  resolveInviteTime,
  toInviteForViewer,
  type RawInviteRow,
  type TrainingInviteForViewer,
} from './training-invites';

const ME = 'user-me';
const row = (over: Partial<RawInviteRow> = {}): RawInviteRow => ({
  id: 'inv-1',
  message_id: 'msg-1',
  team_id: 'team-1',
  organizer_id: 'user-org',
  title: 'Beine & Rücken',
  starts_at: '2026-10-03T16:30:00Z',
  activity_type: 'krafttraining',
  place: 'Eingang Studio',
  note: 'Bring ein Handtuch',
  plan_share_id: null,
  rsvp_version: 3,
  cancelled_at: null,
  edited_at: null,
  created_at: '2026-10-01T10:00:00Z',
  organizer: { id: 'user-org', full_name: ' Tim Organ ', avatar_url: 'a.png' },
  plan_share: null,
  training_invite_rsvps: [],
  ...over,
});
const viewerInvite = (over: Partial<TrainingInviteForViewer> = {}): TrainingInviteForViewer => ({ ...toInviteForViewer(row(), ME), ...over });

describe('toInviteForViewer', () => {
  it('maps the row and keeps the viewer\'s own answer apart from everyone else\'s', () => {
    const inv = toInviteForViewer(
      row({
        training_invite_rsvps: [
          { user_id: 'u-b', status: 'maybe', profiles: { full_name: 'Berta', avatar_url: null } },
          { user_id: ME, status: 'going', profiles: { full_name: 'Ich', avatar_url: null } },
          { user_id: 'u-a', status: 'going', profiles: { full_name: 'Anton', avatar_url: 'x.png' } },
          { user_id: 'u-c', status: 'going', profiles: null },
        ],
      }),
      ME,
    );
    expect(inv).toMatchObject({
      id: 'inv-1', messageId: 'msg-1', teamId: 'team-1', organizerId: 'user-org', organizerName: 'Tim Organ', organizerAvatar: 'a.png',
      title: 'Beine & Rücken', place: 'Eingang Studio', note: 'Bring ein Handtuch', activityType: 'krafttraining', rsvpVersion: 3, myStatus: 'going',
    });
    // going before maybe, then alphabetical; missing names get a neutral label; "me" is never in `others`.
    expect(inv.others.map((o) => [o.name, o.status])).toEqual([['Anton', 'going'], ['Teammitglied', 'going'], ['Berta', 'maybe']]);
  });

  it('myStatus is null when the viewer has not answered; a missing organizer profile is labelled neutrally', () => {
    const inv = toInviteForViewer(row({ organizer: null }), ME);
    expect(inv.myStatus).toBeNull();
    expect(inv.organizerName).toBe('Ein Teammitglied');
  });

  it('carries a linked template only as id, title and withdrawn state', () => {
    const inv = toInviteForViewer(row({ plan_share_id: 'ps-1', plan_share: { id: 'ps-1', title: 'Push Day', withdrawn_at: '2026-10-02T08:00:00Z' } }), ME);
    expect(inv.planShare).toEqual({ id: 'ps-1', title: 'Push Day', withdrawnAt: '2026-10-02T08:00:00Z' });
  });
});

describe('counts and participants', () => {
  const withAnswers = viewerInvite({
    myStatus: 'maybe',
    others: [
      { userId: 'a', name: 'Anton', avatarUrl: null, status: 'going' },
      { userId: 'b', name: 'Berta', avatarUrl: null, status: 'going' },
      { userId: 'c', name: 'Carl', avatarUrl: null, status: 'maybe' },
    ],
  });

  it('counts include the viewer\'s own answer', () => {
    expect(inviteCounts(withAnswers)).toEqual({ going: 2, maybe: 2 });
    expect(inviteCounts(viewerInvite())).toEqual({ going: 0, maybe: 0 });
  });

  it('words the counts, and an honest empty state', () => {
    expect(countsLabel({ going: 3, maybe: 1 })).toBe('3 dabei · 1 vielleicht');
    expect(countsLabel({ going: 2, maybe: 0 })).toBe('2 dabei');
    expect(countsLabel({ going: 0, maybe: 4 })).toBe('4 vielleicht');
    expect(countsLabel({ going: 0, maybe: 0 })).toBe('Noch keine Antworten');
  });

  it('lists the viewer first as "Du"', () => {
    const list = inviteParticipants(withAnswers);
    expect(list[0]).toMatchObject({ name: 'Du', status: 'maybe', isMe: true });
    expect(list.slice(1).map((p) => p.name)).toEqual(['Anton', 'Berta', 'Carl']);
    expect(inviteParticipants(viewerInvite()).every((p) => !p.isMe)).toBe(true);
  });
});

describe('inviteState', () => {
  const NOW = new Date('2026-10-03T16:30:00Z');
  it('is upcoming until the start instant, then started', () => {
    expect(inviteState({ cancelledAt: null, startsAt: '2026-10-03T16:30:01Z' }, NOW)).toBe('upcoming');
    expect(inviteState({ cancelledAt: null, startsAt: '2026-10-03T16:30:00Z' }, NOW)).toBe('started');
    expect(inviteState({ cancelledAt: null, startsAt: '2026-10-03T10:00:00Z' }, NOW)).toBe('started');
  });
  it('cancelled wins over everything', () => {
    expect(inviteState({ cancelledAt: '2026-10-02T09:00:00Z', startsAt: '2026-10-03T10:00:00Z' }, NOW)).toBe('cancelled');
    expect(inviteState({ cancelledAt: '2026-10-02T09:00:00Z', startsAt: '2026-10-09T10:00:00Z' }, NOW)).toBe('cancelled');
  });
});

describe('applyOwnRsvp', () => {
  it('sets, changes and removes only the viewer\'s own answer', () => {
    const base = viewerInvite({ others: [{ userId: 'a', name: 'Anton', avatarUrl: null, status: 'going' }] });
    const going = applyOwnRsvp(base, 'going');
    expect(going.myStatus).toBe('going');
    expect(going.others).toBe(base.others);
    expect(applyOwnRsvp(going, 'maybe').myStatus).toBe('maybe');
    expect(applyOwnRsvp(going, null).myStatus).toBeNull();
  });
  it('returns the same object when nothing changes (no needless re-render)', () => {
    const inv = viewerInvite({ myStatus: 'going' });
    expect(applyOwnRsvp(inv, 'going')).toBe(inv);
  });
});

describe('formatInviteWhen', () => {
  const NOW = new Date('2026-10-02T10:00:00Z'); // Fri 12:00 Berlin
  it('says Heute / Morgen / weekday-and-date, in Berlin time', () => {
    expect(formatInviteWhen('2026-10-02T16:30:00Z', NOW)).toBe('Heute · 18:30');
    expect(formatInviteWhen('2026-10-03T05:00:00Z', NOW)).toBe('Morgen · 07:00');
    expect(formatInviteWhen('2026-10-03T16:30:00Z', new Date('2026-10-01T10:00:00Z'))).toBe('Sa., 03.10. · 18:30');
    expect(formatInviteWhen('2026-10-10T08:00:00Z', NOW)).toBe('Sa., 10.10. · 10:00');
  });

  it('uses the Berlin calendar day around midnight, not the UTC day', () => {
    // 22:30 UTC on Oct 2 is 00:30 CEST on Oct 3 in Berlin: "Morgen", not "Heute".
    expect(formatInviteWhen('2026-10-02T22:30:00Z', NOW)).toBe('Morgen · 00:30');
    // 21:30 UTC is 23:30 Berlin on the 2nd: still "Heute".
    expect(formatInviteWhen('2026-10-02T21:30:00Z', NOW)).toBe('Heute · 23:30');
  });

  it('adds MESZ/MEZ only for the one hour a year that occurs twice', () => {
    const now = new Date('2026-10-20T10:00:00Z');
    expect(formatInviteWhen('2026-10-25T00:30:00Z', now)).toBe('So., 25.10. · 02:30 MESZ');
    expect(formatInviteWhen('2026-10-25T01:30:00Z', now)).toBe('So., 25.10. · 02:30 MEZ');
    expect(formatInviteWhen('2026-10-24T23:59:00Z', now)).toBe('So., 25.10. · 01:59'); // before the repeated hour
    expect(formatInviteWhen('2026-10-25T02:00:00Z', now)).toBe('So., 25.10. · 03:00'); // after it
    expect(formatInviteWhen('2026-07-15T16:30:00Z', now)).toBe('Mi., 15.07. · 18:30'); // ordinary day: no suffix
  });
});

describe('cleanInviteInput', () => {
  const input = (over: Record<string, unknown> = {}) => ({ title: 'Lauftreff', activityType: 'laufen', place: 'Parkplatz', note: 'Locker', planShareId: '', ...over });

  it('trims, and turns empty optional text into null', () => {
    expect(cleanInviteInput(input({ title: '  Lauftreff  ', place: '  ', note: '', activityType: '' }))).toEqual({
      ok: true,
      value: { title: 'Lauftreff', activityType: null, place: null, note: null, planShareId: null },
    });
  });

  it('enforces the same bounds as the database', () => {
    expect(cleanInviteInput(input({ title: '' }))).toEqual({ ok: false, error: 'invalid_title' });
    expect(cleanInviteInput(input({ title: '   ' }))).toEqual({ ok: false, error: 'invalid_title' });
    expect(cleanInviteInput(input({ title: 'x'.repeat(80) })).ok).toBe(true);
    expect(cleanInviteInput(input({ title: 'x'.repeat(81) }))).toEqual({ ok: false, error: 'invalid_title' });
    expect(cleanInviteInput(input({ place: 'x'.repeat(80) })).ok).toBe(true);
    expect(cleanInviteInput(input({ place: 'x'.repeat(81) }))).toEqual({ ok: false, error: 'invalid_place' });
    expect(cleanInviteInput(input({ note: 'x'.repeat(200) })).ok).toBe(true);
    expect(cleanInviteInput(input({ note: 'x'.repeat(201) }))).toEqual({ ok: false, error: 'invalid_note' });
  });

  it('accepts only the known training types and a real template id', () => {
    expect(cleanInviteInput(input({ activityType: 'yoga' }))).toEqual({ ok: false, error: 'invalid_activity_type' });
    expect(cleanInviteInput(input({ planShareId: 'not-a-uuid' }))).toEqual({ ok: false, error: 'invalid_plan_share' });
    expect(cleanInviteInput(input({ planShareId: '3f2b8a52-6c1d-4f5e-9a3b-0d2c4e6f8a10' }))).toMatchObject({ ok: true, value: { planShareId: '3f2b8a52-6c1d-4f5e-9a3b-0d2c4e6f8a10' } });
  });

  it('treats non-string input as empty rather than throwing', () => {
    expect(cleanInviteInput({ title: null, activityType: undefined, place: 5, note: {}, planShareId: [] })).toEqual({ ok: false, error: 'invalid_title' });
  });
});

describe('inviteErrorText', () => {
  it('maps each database error to a German sentence and falls back sensibly', () => {
    expect(inviteErrorText('invalid_title')).toContain('Titel');
    expect(inviteErrorText('invalid_start_time')).toContain('Zukunft');
    expect(inviteErrorText('invite_closed')).toContain('abgesagt');
    expect(inviteErrorText('invite_started')).toContain('begonnen');
    expect(inviteErrorText('invite_not_found')).toContain('nicht mehr');
    expect(inviteErrorText('invalid_plan_share')).toContain('Vorlage');
    expect(inviteErrorText('???')).toContain('nicht geklappt');
    expect(inviteErrorText(undefined)).toContain('nicht geklappt');
  });
});

describe('resolveInviteTime', () => {
  const NOW = new Date('2026-10-20T10:00:00Z');

  it('resolves an ordinary future time', () => {
    const r = resolveInviteTime('2026-10-22T18:30', null, NOW);
    expect(r.kind).toBe('ok');
    expect(r.kind === 'ok' && r.instant.toISOString()).toBe('2026-10-22T16:30:00.000Z');
  });

  it('rejects malformed values, the past (including "right now") and anything beyond 90 days', () => {
    expect(resolveInviteTime('morgen 18 Uhr', null, NOW).kind).toBe('invalid');
    expect(resolveInviteTime('2026-02-30T10:00', null, NOW).kind).toBe('invalid');
    expect(resolveInviteTime('2026-10-19T18:30', null, NOW).kind).toBe('past');
    expect(resolveInviteTime('2026-10-20T12:00', null, NOW).kind).toBe('past'); // 12:00 Berlin == NOW exactly
    expect(resolveInviteTime('2026-10-20T12:01', null, NOW).kind).toBe('ok');
    expect(resolveInviteTime('2027-02-01T18:30', null, NOW).kind).toBe('too_far');
    expect(resolveInviteTime('2027-01-17T18:30', null, NOW).kind).toBe('ok'); // 89 days out
  });

  it('asks about a spring-forward gap time instead of guessing, offering the two real readings', () => {
    const now = new Date('2026-03-20T10:00:00Z');
    const r = resolveInviteTime('2026-03-29T02:30', null, now);
    expect(r.kind).toBe('check');
    if (r.kind !== 'check') return;
    expect(r.check).toMatchObject({ kind: 'gap', forValue: '2026-03-29T02:30' });
    expect(r.check.message).toContain('02:30');
    expect(r.check.message).toContain('Zeitumstellung');
    expect(r.check.choices).toEqual([
      { value: 'before', label: '01:30 Uhr' },
      { value: 'after', label: '03:30 Uhr' },
    ]);
  });

  it('applies the organizer\'s pick for a gap time', () => {
    const now = new Date('2026-03-20T10:00:00Z');
    const before = resolveInviteTime('2026-03-29T02:30', 'before', now);
    expect(before.kind === 'ok' && before.instant.toISOString()).toBe('2026-03-29T00:30:00.000Z'); // 01:30 CET
    const after = resolveInviteTime('2026-03-29T02:30', 'after', now);
    expect(after.kind === 'ok' && after.instant.toISOString()).toBe('2026-03-29T01:30:00.000Z'); // 03:30 CEST
    // A pick that does not belong to a gap is ignored — the question is asked again.
    expect(resolveInviteTime('2026-03-29T02:30', 'first', now).kind).toBe('check');
  });

  it('asks about a fall-back overlap time and applies the pick', () => {
    const r = resolveInviteTime('2026-10-25T02:30', null, NOW);
    expect(r.kind).toBe('check');
    if (r.kind !== 'check') return;
    expect(r.check).toMatchObject({ kind: 'ambiguous', forValue: '2026-10-25T02:30' });
    expect(r.check.choices.map((c) => c.label)).toEqual(['02:30 Uhr (MESZ, Sommerzeit)', '02:30 Uhr (MEZ, Winterzeit)']);

    const summer = resolveInviteTime('2026-10-25T02:30', 'first', NOW);
    expect(summer.kind === 'ok' && summer.instant.toISOString()).toBe('2026-10-25T00:30:00.000Z');
    const winter = resolveInviteTime('2026-10-25T02:30', 'second', NOW);
    expect(winter.kind === 'ok' && winter.instant.toISOString()).toBe('2026-10-25T01:30:00.000Z');
    expect(resolveInviteTime('2026-10-25T02:30', 'before', NOW).kind).toBe('check');
  });

  it('a picked time still has to be in the future', () => {
    const justAfterTheOverlap = new Date('2026-10-25T00:45:00Z'); // between the two readings of 02:30
    expect(resolveInviteTime('2026-10-25T02:30', 'first', justAfterTheOverlap).kind).toBe('past');
    expect(resolveInviteTime('2026-10-25T02:30', 'second', justAfterTheOverlap).kind).toBe('ok');
  });

  it('times next to the transitions are ordinary', () => {
    for (const v of ['2026-10-25T01:59', '2026-10-25T03:00', '2026-10-25T12:00']) expect(resolveInviteTime(v, null, NOW).kind, v).toBe('ok');
    const spring = new Date('2026-03-20T10:00:00Z');
    for (const v of ['2026-03-29T01:59', '2026-03-29T03:00', '2026-03-29T12:00']) expect(resolveInviteTime(v, null, spring).kind, v).toBe('ok');
  });
});
