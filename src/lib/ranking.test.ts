import { describe, expect, it } from 'vitest';
import { computeRanks, isUnrankedTie, nearbyWindow, nextHigherRankGap, type ScoreRow } from './ranking';

describe('computeRanks', () => {
  it('assigns competition ranking: a tie shares a rank, the next distinct score skips to its true position', () => {
    const rows: ScoreRow[] = [
      { userId: 'a', points: 100 },
      { userId: 'b', points: 100 },
      { userId: 'c', points: 90 },
      { userId: 'd', points: 80 },
    ];
    expect(computeRanks(rows).map((r) => r.rank)).toEqual([1, 1, 3, 4]);
  });

  it('handles a large tied block followed by one distinct lower score', () => {
    const rows: ScoreRow[] = [
      { userId: 'top', points: 100 },
      { userId: 'a', points: 50 },
      { userId: 'b', points: 50 },
      { userId: 'c', points: 50 },
      { userId: 'd', points: 50 },
      { userId: 'e', points: 50 },
      { userId: 'f', points: 50 },
      { userId: 'g', points: 40 },
    ];
    expect(computeRanks(rows).map((r) => r.rank)).toEqual([1, 2, 2, 2, 2, 2, 2, 8]);
  });

  it('ranks a single row as 1', () => {
    expect(computeRanks([{ userId: 'a', points: 0 }]).map((r) => r.rank)).toEqual([1]);
  });
});

describe('isUnrankedTie', () => {
  it('is true when every row is zero', () => {
    expect(
      isUnrankedTie([
        { userId: 'a', points: 0 },
        { userId: 'b', points: 0 },
      ])
    ).toBe(true);
  });

  it('is true for an empty list', () => {
    expect(isUnrankedTie([])).toBe(true);
  });

  it('is false as soon as anyone has points', () => {
    expect(
      isUnrankedTie([
        { userId: 'a', points: 0 },
        { userId: 'b', points: 10 },
      ])
    ).toBe(false);
  });
});

describe('nearbyWindow', () => {
  const ranked = computeRanks([
    { userId: 'a', points: 100 },
    { userId: 'b', points: 90 },
    { userId: 'c', points: 80 },
    { userId: 'd', points: 70 },
    { userId: 'e', points: 60 },
    { userId: 'f', points: 50 },
  ]);

  it('returns up to `radius` rows above and below the user', () => {
    expect(nearbyWindow(ranked, 'd', 2)?.map((r) => r.userId)).toEqual(['b', 'c', 'd', 'e', 'f']);
  });

  it('clamps at the top of the list instead of going out of bounds', () => {
    expect(nearbyWindow(ranked, 'a', 2)?.map((r) => r.userId)).toEqual(['a', 'b', 'c']);
  });

  it('clamps at the bottom of the list', () => {
    expect(nearbyWindow(ranked, 'f', 2)?.map((r) => r.userId)).toEqual(['d', 'e', 'f']);
  });

  it('returns null when the user has no row (no scored activity this period)', () => {
    expect(nearbyWindow(ranked, 'ghost', 2)).toBeNull();
  });
});

describe('nextHigherRankGap', () => {
  it('finds the next distinct score and its true rank, skipping a tied block directly above', () => {
    const ranked = computeRanks([
      { userId: 'top', points: 100 },
      { userId: 'a', points: 50 },
      { userId: 'b', points: 50 },
      { userId: 'c', points: 50 },
      { userId: 'me', points: 40 },
    ]);
    // 'a'/'b'/'c' all hold rank 2 — the gap must report that rank, not "me.rank - 1" (which would be 4).
    expect(nextHigherRankGap(ranked, 'me')).toEqual({ rank: 2, pointsNeeded: 10 });
  });

  it('is null for a member of the top scoring group — never "0 points to overtake" a tied peer', () => {
    const ranked = computeRanks([
      { userId: 'a', points: 100 },
      { userId: 'b', points: 100 },
      { userId: 'c', points: 50 },
    ]);
    expect(nextHigherRankGap(ranked, 'a')).toBeNull();
  });

  it('is null when the user has no row', () => {
    const ranked = computeRanks([{ userId: 'a', points: 100 }]);
    expect(nextHigherRankGap(ranked, 'ghost')).toBeNull();
  });
});
