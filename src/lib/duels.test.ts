import { describe, expect, it } from 'vitest';
import {
  DUEL_TARGET_DEFAULT,
  daysBetweenKeys,
  duelDaysLeft,
  duelErrorText,
  duelOutcome,
  duelPhase,
  duelWindow,
  formatDuelLines,
  formatDuelRange,
  formatReplyDeadline,
  pickHomeDuel,
  trainingDaysLabel,
  validateDuelInput,
  type DuelTerms,
  type DuelView,
} from './duels';

const INVITEE = '3f2b8a52-6c1d-4f5e-9a3b-0d2c4e6f8a10';

describe('duelPhase', () => {
  const terms = (over: Partial<DuelTerms> = {}): DuelTerms => ({
    status: 'accepted',
    starts_on: '2026-10-05',
    ends_on: '2026-10-11',
    expires_at: '2026-10-04T22:00:00Z',
    ...over,
  });

  it('passes through the terminal statuses', () => {
    for (const status of ['declined', 'cancelled', 'expired'] as const) {
      expect(duelPhase(terms({ status }), new Date('2026-10-06T10:00:00Z'))).toBe(status);
    }
  });

  it('a pending invitation is pending only while it is live', () => {
    const pending = terms({ status: 'pending', expires_at: '2026-10-04T22:00:00Z' });
    expect(duelPhase(pending, new Date('2026-10-03T09:00:00Z'))).toBe('pending');
    // past its expiry instant -> expired even though the row still says pending
    expect(duelPhase(pending, new Date('2026-10-04T22:00:00Z'))).toBe('expired');
    expect(duelPhase(pending, new Date('2026-10-04T23:00:00Z'))).toBe('expired');
  });

  it('a pending invitation whose start date has arrived is expired — no retroactive start — even if its expiry says otherwise', () => {
    const odd = terms({ status: 'pending', expires_at: '2026-10-20T00:00:00Z' });
    // 2026-10-05 00:30 Berlin (CEST)
    expect(duelPhase(odd, new Date('2026-10-04T22:30:00Z'))).toBe('expired');
    // 2026-10-04 23:30 Berlin: still the day before the start
    expect(duelPhase(odd, new Date('2026-10-04T21:30:00Z'))).toBe('pending');
  });

  it('an accepted duel is upcoming, then active from Berlin midnight of its first day, then finished after its last day', () => {
    const accepted = terms();
    expect(duelPhase(accepted, new Date('2026-10-04T21:59:00Z'))).toBe('upcoming'); // 23:59 Berlin on the 4th
    expect(duelPhase(accepted, new Date('2026-10-04T22:00:00Z'))).toBe('active'); // 00:00 Berlin on the 5th
    expect(duelPhase(accepted, new Date('2026-10-11T21:59:00Z'))).toBe('active'); // 23:59 Berlin on the 11th
    expect(duelPhase(accepted, new Date('2026-10-11T22:00:00Z'))).toBe('finished'); // 00:00 Berlin on the 12th
  });

  it('keeps the same boundaries across the spring clock change (2026-03-29)', () => {
    const endsOnSwitch = terms({ starts_on: '2026-03-23', ends_on: '2026-03-29' });
    expect(duelPhase(endsOnSwitch, new Date('2026-03-29T21:30:00Z'))).toBe('active'); // 23:30 CEST on the 29th
    expect(duelPhase(endsOnSwitch, new Date('2026-03-29T22:00:00Z'))).toBe('finished'); // 00:00 CEST on the 30th
    const startsOnSwitch = terms({ starts_on: '2026-03-29', ends_on: '2026-04-04' });
    expect(duelPhase(startsOnSwitch, new Date('2026-03-28T22:59:00Z'))).toBe('upcoming'); // 23:59 CET on the 28th
    expect(duelPhase(startsOnSwitch, new Date('2026-03-28T23:00:00Z'))).toBe('active'); // 00:00 CET on the 29th
  });

  it('keeps the same boundaries across the autumn clock change (2026-10-25)', () => {
    const endsOnSwitch = terms({ starts_on: '2026-10-19', ends_on: '2026-10-25' });
    expect(duelPhase(endsOnSwitch, new Date('2026-10-25T22:30:00Z'))).toBe('active'); // 23:30 CET on the 25th
    expect(duelPhase(endsOnSwitch, new Date('2026-10-25T23:00:00Z'))).toBe('finished'); // 00:00 CET on the 26th
    const startsOnSwitch = terms({ starts_on: '2026-10-25', ends_on: '2026-10-31' });
    expect(duelPhase(startsOnSwitch, new Date('2026-10-24T21:59:00Z'))).toBe('upcoming'); // 23:59 CEST on the 24th
    expect(duelPhase(startsOnSwitch, new Date('2026-10-24T22:00:00Z'))).toBe('active'); // 00:00 CEST on the 25th
  });
});

describe('duelWindow', () => {
  it('is exactly seven consecutive calendar dates', () => {
    const w = duelWindow('2026-10-05');
    expect(w.days).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    expect(w.startsOn).toBe('2026-10-05');
    expect(w.endsOn).toBe('2026-10-11');
  });

  it('neither skips nor repeats a date across a daylight-saving day or a month/year end', () => {
    expect(duelWindow('2026-03-25').days).toContain('2026-03-29');
    expect(new Set(duelWindow('2026-03-25').days).size).toBe(7);
    expect(duelWindow('2026-10-22').days.slice(3)).toEqual(['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']);
    expect(duelWindow('2026-12-28').endsOn).toBe('2027-01-03');
  });
});

describe('formatting', () => {
  it('formats the date range and the goal', () => {
    expect(formatDuelRange('2026-10-05', '2026-10-11')).toBe('Mo., 05.10. – So., 11.10.');
    expect(trainingDaysLabel(1)).toBe('1 Trainingstag');
    expect(trainingDaysLabel(3)).toBe('3 Trainingstage');
  });

  it('formatDuelLines renders "A vs. B", the goal and capped counts, other person first', () => {
    const lines = formatDuelLines({ myName: 'Volodymyr', otherName: 'Tim', target: 3, myDays: 1, otherDays: 2 });
    expect(lines).toEqual({ title: 'Volodymyr vs. Tim', goal: 'Ziel: 3 Trainingstage', other: 'Tim: 2 / 3', me: 'Du: 1 / 3' });
    const capped = formatDuelLines({ myName: 'A', otherName: 'B', target: 2, myDays: 9, otherDays: -1 });
    expect(capped.me).toBe('Du: 2 / 2');
    expect(capped.other).toBe('B: 0 / 2');
  });
});

describe('duelOutcome', () => {
  const outcome = (target: number, me: number, other: number) =>
    duelOutcome({ target, me: { name: 'Ich', days: me }, other: { name: 'Tim', days: other } });

  it('both reaching the goal is a shared success with the agreed headline', () => {
    const o = outcome(3, 3, 3);
    expect(o.kind).toBe('both');
    expect(o.headline).toBe('Beide haben das Ziel erreicht!');
  });

  it('counts beyond the goal change nothing (extra days never exceed it)', () => {
    expect(outcome(3, 7, 5)).toEqual(outcome(3, 3, 3));
  });

  it('one person reaching it is acknowledged without comparing or blaming the other', () => {
    const mine = outcome(3, 3, 1);
    expect(mine.kind).toBe('one');
    expect(mine.headline).toBe('Du hast dein Ziel erreicht!');
    expect(mine.detail).toContain('Tim kam auf 1 von 3');
    const theirs = outcome(3, 2, 3);
    expect(theirs.kind).toBe('one');
    expect(theirs.headline).toBe('Tim hat das Ziel erreicht.');
    expect(theirs.detail).toContain('Du kamst auf 2 von 3');
  });

  it('neither reaching it reports honest progress and nothing else', () => {
    const o = outcome(5, 2, 1);
    expect(o.kind).toBe('none');
    expect(o.headline).toBe('Das Duell ist beendet.');
    expect(o.detail).toContain('Du: 2 von 5');
    expect(o.detail).toContain('Tim: 1 von 5');
  });

  it('is symmetric when both reach it — nothing depends on who was first', () => {
    expect(duelOutcome({ target: 4, me: { name: 'A', days: 4 }, other: { name: 'B', days: 4 } }).headline).toBe(
      duelOutcome({ target: 4, me: { name: 'B', days: 4 }, other: { name: 'A', days: 4 } }).headline,
    );
  });

  it('never uses winner/loser/speed wording, for any combination of target and counts', () => {
    const forbidden = /gewonn|verlor|sieg|verlierer|schneller|besiegt|niederlage|rückstand|versag|faul/i;
    for (let target = 1; target <= 7; target++) {
      for (let me = 0; me <= 7; me++) {
        for (let other = 0; other <= 7; other++) {
          const o = outcome(target, me, other);
          expect(`${o.headline} ${o.detail}`, `${target}/${me}/${other}`).not.toMatch(forbidden);
          expect(o.kind === 'both', `${target}/${me}/${other}`).toBe(me >= target && other >= target);
        }
      }
    }
  });
});

describe('validateDuelInput', () => {
  const NOW = new Date('2026-10-02T10:00:00Z'); // 12:00 Berlin, Fri 2026-10-02
  const input = (over: Record<string, unknown> = {}) => ({ inviteeId: INVITEE, targetDays: '3', startsOn: '2026-10-05', ...over });

  it('accepts a valid proposal and normalises the target to a number', () => {
    expect(validateDuelInput(input(), NOW)).toEqual({ ok: true, value: { inviteeId: INVITEE, targetDays: 3, startsOn: '2026-10-05' } });
    expect(DUEL_TARGET_DEFAULT).toBe(3);
  });

  it('start must be strictly after today (Berlin) and at most 14 days out', () => {
    expect(validateDuelInput(input({ startsOn: '2026-10-02' }), NOW)).toEqual({ ok: false, error: 'invalid_start_date' }); // today
    expect(validateDuelInput(input({ startsOn: '2026-10-01' }), NOW)).toEqual({ ok: false, error: 'invalid_start_date' }); // yesterday
    expect(validateDuelInput(input({ startsOn: '2026-10-03' }), NOW).ok).toBe(true); // tomorrow
    expect(validateDuelInput(input({ startsOn: '2026-10-16' }), NOW).ok).toBe(true); // +14
    expect(validateDuelInput(input({ startsOn: '2026-10-17' }), NOW)).toEqual({ ok: false, error: 'invalid_start_date' }); // +15
  });

  it('"today" is the Berlin date, not the UTC one', () => {
    // 22:30 UTC on Oct 2 is already 00:30 CEST on Oct 3 in Berlin.
    const lateEvening = new Date('2026-10-02T22:30:00Z');
    expect(validateDuelInput(input({ startsOn: '2026-10-03' }), lateEvening)).toEqual({ ok: false, error: 'invalid_start_date' });
    expect(validateDuelInput(input({ startsOn: '2026-10-04' }), lateEvening).ok).toBe(true);
  });

  it('rejects malformed or impossible dates', () => {
    for (const startsOn of ['2026-02-30', '2026-13-01', 'morgen', '', '05.10.2026', '2026-10-5', null, undefined, 20261005]) {
      expect(validateDuelInput(input({ startsOn }), NOW), String(startsOn)).toEqual({ ok: false, error: 'invalid_start_date' });
    }
  });

  it('target must be a whole number from 1 to 7', () => {
    for (const targetDays of ['0', '8', '2.5', '', 'drei', null, undefined, true, -1, NaN]) {
      expect(validateDuelInput(input({ targetDays }), NOW), String(targetDays)).toEqual({ ok: false, error: 'invalid_target_days' });
    }
    for (const targetDays of ['1', 7, '7', 4]) expect(validateDuelInput(input({ targetDays }), NOW).ok).toBe(true);
  });

  it('requires a real person id', () => {
    for (const inviteeId of ['', 'tim', '123', null, undefined, 42]) {
      expect(validateDuelInput(input({ inviteeId }), NOW), String(inviteeId)).toEqual({ ok: false, error: 'invalid_invitee' });
    }
  });
});

describe('duelErrorText', () => {
  it('maps each database error to a German sentence', () => {
    expect(duelErrorText('invalid_start_date')).toContain('Zukunft');
    expect(duelErrorText('invalid_target_days')).toContain('1 und 7');
    expect(duelErrorText('invalid_invitee')).toContain('Teammitglied');
    expect(duelErrorText('already_in_duel')).toContain('Duell');
    expect(duelErrorText('not_a_team_member')).toContain('Team');
    expect(duelErrorText('duel_not_found')).toContain('nicht mehr');
    expect(duelErrorText('something odd')).toContain('nicht geklappt');
    expect(duelErrorText(null)).toContain('nicht geklappt');
  });

  it('the "invitee unavailable" text reveals nothing about why', () => {
    const text = duelErrorText('invitee_unavailable');
    expect(text).toContain('nicht verfügbar');
    expect(text).not.toMatch(/bereits|Duell|Team|belegt|beschäftigt|Mitglied/i);
  });
});

describe('pickHomeDuel', () => {
  const NOW = new Date('2026-10-06T10:00:00Z'); // Tue 2026-10-06, 12:00 Berlin
  const person = (id: string) => ({ id, name: id, avatarUrl: null });
  const duel = (over: Partial<DuelView> & { id: string }): DuelView => ({
    teamId: 't',
    status: 'accepted',
    phase: 'active',
    role: 'inviter',
    targetDays: 3,
    startsOn: '2026-10-05',
    endsOn: '2026-10-11',
    expiresAt: '2026-10-04T22:00:00Z',
    me: person('me'),
    other: person('tim'),
    progress: null,
    ...over,
  });

  it('is null when there is nothing relevant', () => {
    expect(pickHomeDuel([], NOW)).toBeNull();
    expect(pickHomeDuel([duel({ id: 'a', status: 'declined' }), duel({ id: 'b', status: 'cancelled' }), duel({ id: 'c', status: 'expired' })], NOW)).toBeNull();
  });

  it('prefers an invitation waiting for my answer, then a running duel, then an upcoming one, then my own pending invitation', () => {
    const incoming = duel({ id: 'incoming', status: 'pending', role: 'invitee', startsOn: '2026-10-09', endsOn: '2026-10-15', expiresAt: '2026-10-08T22:00:00Z' });
    const outgoing = duel({ id: 'outgoing', status: 'pending', role: 'inviter', startsOn: '2026-10-09', endsOn: '2026-10-15', expiresAt: '2026-10-08T22:00:00Z' });
    const active = duel({ id: 'active' });
    const upcoming = duel({ id: 'upcoming', startsOn: '2026-10-08', endsOn: '2026-10-14' });
    expect(pickHomeDuel([outgoing, upcoming, active, incoming], NOW)?.id).toBe('incoming');
    expect(pickHomeDuel([outgoing, upcoming, active], NOW)?.id).toBe('active');
    expect(pickHomeDuel([outgoing, upcoming], NOW)?.id).toBe('upcoming');
    expect(pickHomeDuel([outgoing], NOW)?.id).toBe('outgoing');
  });

  it('an expired invitation never surfaces, even while the row still says pending', () => {
    const stale = duel({ id: 'stale', status: 'pending', role: 'invitee', startsOn: '2026-10-09', expiresAt: '2026-10-05T10:00:00Z' });
    expect(pickHomeDuel([stale], NOW)).toBeNull();
  });

  it('shows a finished duel only for a few days, and a running duel beats a finished one', () => {
    const finished = duel({ id: 'finished', startsOn: '2026-09-28', endsOn: '2026-10-04' });
    expect(pickHomeDuel([finished], NOW)?.id).toBe('finished'); // ended 2 days ago
    expect(pickHomeDuel([finished], new Date('2026-10-07T10:00:00Z'))?.id).toBe('finished'); // 3 days
    expect(pickHomeDuel([finished], new Date('2026-10-08T10:00:00Z'))).toBeNull(); // 4 days
    expect(pickHomeDuel([finished, duel({ id: 'active' })], NOW)?.id).toBe('active');
  });

  it('keeps the given (newest-first) order within one group', () => {
    const first = duel({ id: 'first' });
    const second = duel({ id: 'second' });
    expect(pickHomeDuel([first, second], NOW)?.id).toBe('first');
  });
});

describe('daysBetweenKeys / duelDaysLeft', () => {
  it('counts whole calendar days, across month ends and daylight-saving days', () => {
    expect(daysBetweenKeys('2026-10-02', '2026-10-09')).toBe(7);
    expect(daysBetweenKeys('2026-10-30', '2026-11-02')).toBe(3);
    expect(daysBetweenKeys('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetweenKeys('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetweenKeys('2026-10-09', '2026-10-02')).toBe(-7);
  });

  it('days left of a running duel include today and floor at zero', () => {
    expect(duelDaysLeft('2026-10-11', new Date('2026-10-06T10:00:00Z'))).toBe(6); // Tue..Sun
    expect(duelDaysLeft('2026-10-11', new Date('2026-10-11T10:00:00Z'))).toBe(1); // last day
    expect(duelDaysLeft('2026-10-11', new Date('2026-10-12T10:00:00Z'))).toBe(0);
    expect(duelDaysLeft('2026-10-11', new Date('2026-10-20T10:00:00Z'))).toBe(0);
    // 23:30 UTC on the 10th is already 01:30 on the 11th in Berlin
    expect(duelDaysLeft('2026-10-11', new Date('2026-10-10T23:30:00Z'))).toBe(1);
  });
});

describe('formatReplyDeadline', () => {
  it('names day and time for an invitation that lapses mid-day', () => {
    expect(formatReplyDeadline('2026-10-08T12:30:00Z')).toBe('Do., 08.10., 14:30 Uhr'); // CEST
    expect(formatReplyDeadline('2026-12-08T12:30:00Z')).toBe('Di., 08.12., 13:30 Uhr'); // CET
  });

  it('describes a lapse at Berlin midnight (the duel\'s start) as the end of the day before', () => {
    // 2026-10-05 00:00 CEST = 2026-10-04T22:00:00Z; the duel starts Monday the 5th
    expect(formatReplyDeadline('2026-10-04T22:00:00Z')).toBe('Ende So., 04.10.');
    // 2026-03-30 00:00 CEST = 2026-03-29T22:00:00Z (the day after the clock change)
    expect(formatReplyDeadline('2026-03-29T22:00:00Z')).toBe('Ende So., 29.03.');
  });
});
