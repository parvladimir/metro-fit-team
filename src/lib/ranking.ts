/** Pure ranking helpers (no DB access) — shared by the full /team ranking
 * page and the Home "Dein Platz" nearby-window card, so both ever use one
 * tie convention and one "points to next" definition. Kept out of
 * `data/team.ts` (which is `server-only`) so this stays plain-import
 * unit-testable, matching how `reactions.ts`/`event-social.ts` relate to
 * their own `data/*.ts` loaders. */

export interface ScoreRow {
  userId: string;
  points: number;
}

export interface RankedScoreRow extends ScoreRow {
  /** Competition ranking: a tie shares a rank, the next distinct score skips
   * to its true position (1, 1, 3, 4) — never a fabricated distinct rank for
   * equal scores. */
  rank: number;
}

/** `rows` must already be sorted by points descending (as every ranking RPC
 * in this app already returns it). */
export function computeRanks(rows: ScoreRow[]): RankedScoreRow[] {
  let rank = 0;
  let lastPoints: number | null = null;
  return rows.map((row, i) => {
    if (lastPoints === null || row.points !== lastPoints) rank = i + 1;
    lastPoints = row.points;
    return { ...row, rank };
  });
}

/** True when nobody has scored yet (including an empty ranking) — the signal
 * to show a fair "Noch keine Platzierung" empty state instead of an
 * arbitrary #1 from array order. */
export function isUnrankedTie(rows: ScoreRow[]): boolean {
  return rows.every((r) => r.points === 0);
}

/** Up to `radius` ranked rows above the user, the user, and up to `radius`
 * below. Null when the user has no row in `ranked` (no scored activity yet
 * this period — consistent with the rest of the app's "absent means no
 * rank," not "rank = tied last at zero"). */
export function nearbyWindow(ranked: RankedScoreRow[], userId: string, radius = 2): RankedScoreRow[] | null {
  const idx = ranked.findIndex((r) => r.userId === userId);
  if (idx < 0) return null;
  return ranked.slice(Math.max(0, idx - radius), idx + radius + 1);
}

export interface NextRankGap {
  /** The rank held by the next strictly-higher-scoring group — not
   * necessarily `myRank - 1`: a large tied group can occupy every rank
   * between the user and that group. */
  rank: number;
  pointsNeeded: number;
}

/** The next strictly-higher-scoring group's rank and the points needed to
 * reach it — never a tied peer, so this can never read "0 points to
 * overtake, rank N" against someone tied with you. Null if the user is
 * already in the top group, or absent. Computed against the FULL ranking,
 * not a display window: a large tied block directly above the user could
 * otherwise push the next distinct group further away than a window's own
 * radius, which would make a window-only lookup wrongly report "no one
 * higher." */
export function nextHigherRankGap(ranked: RankedScoreRow[], userId: string): NextRankGap | null {
  const me = ranked.find((r) => r.userId === userId);
  if (!me) return null;
  const higher = ranked.filter((r) => r.points > me.points);
  if (higher.length === 0) return null;
  const nextPoints = Math.min(...higher.map((r) => r.points));
  return { rank: higher.find((r) => r.points === nextPoints)!.rank, pointsNeeded: nextPoints - me.points };
}
