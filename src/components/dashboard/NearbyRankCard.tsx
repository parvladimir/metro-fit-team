import Link from 'next/link';
import { Medal } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import type { NearbyRanking } from '@/lib/data/dashboard';
import { t } from '@/lib/i18n';

/** "Dein Platz" — replaces the old plain "#N" mini-card in place (same grid
 * cell/classes) with up to 2 ranking positions above the user, the user
 * highlighted, and up to 2 below. Reuses get_team_ranking's own fair
 * zero-score/tie handling (via `data === null`) rather than inventing a new
 * empty state — never an arbitrary #1. */
export function NearbyRankCard({ data }: { data: NearbyRanking | null }) {
  return (
    <Link href="/team" className="card accent-team card-accent press flex min-w-0 flex-col justify-between !p-4">
      <div className="flex items-center gap-1.5">
        <span className="icon-chip h-7 w-7">
          <Medal size={15} strokeWidth={2} />
        </span>
        <p className="section-title min-w-0 break-words !text-[10px] !leading-tight !tracking-[0.03em] [hyphens:auto]">Dein Platz</p>
      </div>

      {!data ? (
        <>
          <p className="mt-3 text-3xl font-extrabold tracking-tight tabular-nums text-neutral-500">–</p>
          <p className="text-xs text-neutral-500">{t('dashboard.noRank')}</p>
        </>
      ) : (
        <div className="mt-2 flex flex-col gap-0.5">
          {data.rows.map((r) => (
            <div key={r.userId} className={`flex items-center gap-1.5 rounded-lg px-1 py-0.5 ${r.userId === data.myUserId ? 'bg-brand/[0.12]' : ''}`}>
              <span className="w-4 shrink-0 text-center text-[10px] font-bold tabular-nums text-neutral-500">{r.rank}</span>
              <Avatar src={r.avatarUrl} name={r.fullName} size="sm" className="!h-5 !w-5 !text-[9px]" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-900">{r.fullName}</span>
              <span className="shrink-0 text-xs font-bold tabular-nums text-neutral-900">{r.points}</span>
            </div>
          ))}
          <p className="mt-1 truncate text-[11px] text-neutral-500">
            {data.nextRank ? `Abstand zu Platz ${data.nextRank.rank}: ${data.nextRank.pointsNeeded} Punkte` : 'Du führst diese Woche.'}
          </p>
        </div>
      )}
    </Link>
  );
}
