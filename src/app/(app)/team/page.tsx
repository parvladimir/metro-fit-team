import Link from 'next/link';
import clsx from 'clsx';
import { requireAuthUser, getCurrentProfile, getPrimaryTeamMembership } from '@/lib/data/profile';
import { getTeamRankingWithProfiles, type RankingPeriod } from '@/lib/data/team';
import { getTeamChallenges } from '@/lib/data/challenges';
import { getTeamActivityFeed, renderFeedItem } from '@/lib/data/feed';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatGermanDate } from '@/lib/date';
import { t } from '@/lib/i18n';

const PERIODS: RankingPeriod[] = ['current_week', 'last_week', 'current_month', 'all_time'];

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period: periodParam } = await searchParams;
  const period = PERIODS.includes(periodParam as RankingPeriod) ? (periodParam as RankingPeriod) : 'current_week';

  const user = await requireAuthUser();
  const [profile, membership] = await Promise.all([getCurrentProfile(), getPrimaryTeamMembership(user.id)]);

  if (!membership || !profile) {
    return (
      <div className="screen-padding pb-4">
        <h1 className="mb-4 text-2xl font-bold text-neutral-900">{t('team.title')}</h1>
        <EmptyState title={t('team.noTeam.title')} icon="🤝" />
        <p className="mt-3 text-center text-xs text-neutral-400">{t('team.noTeam.description')}</p>
      </div>
    );
  }

  const [ranking, challenges, feed] = await Promise.all([
    getTeamRankingWithProfiles(membership.team_id, period),
    getTeamChallenges(membership.team_id, user.id),
    getTeamActivityFeed(membership.team_id, 15),
  ]);

  const activeChallenge = challenges.find((c) => new Date(c.ends_at) >= new Date());
  const myRankIndex = ranking.findIndex((r) => r.userId === user.id);

  return (
    <div className="screen-padding flex flex-col gap-5 pb-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900">{membership.team_name}</h1>
        {membership.role === 'team_admin' && (
          <Link href="/team/verwalten" className="btn-ghost bg-neutral-100 text-xs">{t('team.manage')}</Link>
        )}
      </div>

      {membership.role === 'team_admin' && (
        <Link
          href="/team/verwalten/einladungen"
          className="card flex items-center gap-3 !py-4 transition active:scale-[0.98]"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xl">📲</span>
          <div className="flex-1">
            <p className="text-sm font-bold text-neutral-900">{t('invite.title')}</p>
            <p className="text-xs text-neutral-400">{t('invite.qrCode')} · {t('invite.copyLink')}</p>
          </div>
          <span className="text-neutral-300">›</span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link href="/team/chat" className="btn-secondary">💬 {t('chat.title')}</Link>
        <Link href="/team/herausforderungen" className="btn-secondary">🏆 {t('challenge.title')}</Link>
      </div>

      {/* Ranking */}
      <section className="card">
        <div className="mb-3 flex items-center justify-between">
          <p className="section-title">{t('team.ranking')}</p>
          {myRankIndex >= 0 && <p className="text-xs font-semibold text-brand">{t('ranking.yourRank')}: #{myRankIndex + 1}</p>}
        </div>

        <div className="mb-3 flex gap-1.5 overflow-x-auto">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`/team?period=${p}`}
              className={clsx(
                'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold',
                p === period ? 'bg-brand text-white' : 'bg-neutral-100 text-neutral-500'
              )}
            >
              {t(`ranking.period.${p}` as const)}
            </Link>
          ))}
        </div>

        {ranking.every((r) => r.points === 0) ? (
          <p className="py-4 text-center text-sm text-neutral-400">{t('ranking.empty')}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {ranking.map((r, i) => (
              <li
                key={r.userId}
                className={clsx(
                  'flex items-center gap-3 rounded-xl px-2 py-2',
                  r.userId === user.id && 'bg-brand-50'
                )}
              >
                <span className="w-5 text-sm font-bold text-neutral-400">{i + 1}</span>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-200 text-xs font-bold text-neutral-600">
                  {r.fullName.charAt(0)}
                </div>
                <span className="flex-1 truncate text-sm font-medium text-neutral-900">{r.fullName}</span>
                <span className="text-sm font-bold text-neutral-900">{r.points}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Challenge */}
      <section className="card">
        <p className="section-title mb-3">{t('team.currentChallenge')}</p>
        {activeChallenge ? (
          <div>
            <p className="text-base font-bold text-neutral-900">{activeChallenge.title}</p>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${Math.min(100, (activeChallenge.myProgress / activeChallenge.target_value) * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              {t('challenge.progress', { current: Math.round(activeChallenge.myProgress), target: activeChallenge.target_value })} ·{' '}
              {t('challenge.deadline', { date: formatGermanDate(activeChallenge.ends_at) })}
            </p>
          </div>
        ) : (
          <p className="text-sm text-neutral-400">{t('challenge.empty.title')}</p>
        )}
      </section>

      {/* Activity feed */}
      <section className="card">
        <p className="section-title mb-3">{t('team.recentActivity')}</p>
        {feed.length === 0 ? (
          <p className="text-sm text-neutral-400">{t('feed.empty.title')}</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {feed.map((item) => (
              <li key={item.id} className="text-sm text-neutral-700">
                {renderFeedItem(item)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
