import Link from 'next/link';
import clsx from 'clsx';
import { QrCode, MessageCircle, Trophy, ChevronRight, Users, Heart, AtSign } from 'lucide-react';
import { requireAuthUser, getCurrentProfile, getPrimaryTeamMembership } from '@/lib/data/profile';
import { getTeamRankingWithProfiles, getTeamRankingRules, type RankingPeriod } from '@/lib/data/team';
import { PointsRulesSheet } from '@/components/team/PointsRulesSheet';
import { getTeamChallenges } from '@/lib/data/challenges';
import { getTeamActivityFeed, renderFeedItem } from '@/lib/data/feed';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { getUnreadChatCount, getRecentNotifications, getUnreadNotificationCount } from '@/lib/data/chat';
import { NotificationCount } from '@/components/notifications/NotificationDot';
import { ChatPushPrompt } from '@/components/chat/ChatPushPrompt';
import { eventDeepLink, inAppNotificationText } from '@/lib/event-social';
import { stripMarkdown } from '@/lib/chat-format';
import { UnreadBadge } from '@/components/chat/UnreadBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Avatar } from '@/components/ui/Avatar';
import { formatGermanDate } from '@/lib/date';
import { t } from '@/lib/i18n';

// Icon + label as one centered group; single line from ~350px, wraps cleanly below.
const ACTION_BTN = 'btn-secondary relative gap-2 px-3 text-sm whitespace-nowrap max-[349px]:gap-1.5 max-[349px]:whitespace-normal max-[349px]:px-2 max-[349px]:text-[13px] max-[349px]:[hyphens:auto] max-[349px]:[overflow-wrap:anywhere] [&>span]:min-w-0';

const PERIODS: RankingPeriod[] = ['current_week', 'last_week', 'current_month', 'all_time'];

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period: periodParam } = await searchParams;
  const period = PERIODS.includes(periodParam as RankingPeriod) ? (periodParam as RankingPeriod) : 'current_week';

  const user = await requireAuthUser();
  const [profile, membership] = await Promise.all([getCurrentProfile(), getPrimaryTeamMembership(user.id)]);

  if (!membership || !profile) {
    return (
      <div className="screen-padding pb-4">
        <h1 className="mb-4 text-page-title text-neutral-900">{t('team.title')}</h1>
        <EmptyState title={t('team.noTeam.title')} icon={Users} accent="team" />
        <p className="mt-3 text-center text-xs text-neutral-400">{t('team.noTeam.description')}</p>
      </div>
    );
  }

  const [ranking, challenges, feed, unreadChatCount, notifications, notificationCount, rankingRules] = await Promise.all([
    getTeamRankingWithProfiles(membership.team_id, period),
    getTeamChallenges(membership.team_id, user.id),
    getTeamActivityFeed(membership.team_id, 15),
    getUnreadChatCount(membership.team_id),
    getRecentNotifications(user.id, 4),
    getUnreadNotificationCount(user.id),
    getTeamRankingRules(membership.team_id),
  ]);

  const activeChallenge = challenges.find((c) => new Date(c.ends_at) >= new Date());
  const myRankIndex = ranking.findIndex((r) => r.userId === user.id);

  return (
    <div className="screen-padding flex flex-col gap-5 pb-4">
      <div className="flex items-start justify-between gap-3">
        <h1 className="min-w-0 text-balance text-page-title text-neutral-900">{membership.team_name}</h1>
        {membership.role === 'team_admin' && (
          <Link href="/team/verwalten" className="btn-ghost mt-0.5 shrink-0 bg-neutral-100 text-xs">{t('team.manage')}</Link>
        )}
      </div>

      {membership.role === 'team_admin' && (
        <Link
          href="/team/verwalten/einladungen"
          className="accent-primary card-accent list-row !py-4"
        >
          <span className="icon-chip h-11 w-11">
            <QrCode size={20} strokeWidth={2} />
          </span>
          <div className="flex-1">
            <p className="text-sm font-bold text-neutral-900">{t('invite.title')}</p>
            <p className="text-xs text-neutral-500">{t('invite.qrCode')} · {t('invite.copyLink')} · E-Mail</p>
          </div>
          <ChevronRight size={18} className="shrink-0 text-neutral-400" />
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link href="/team/chat" className={ACTION_BTN}>
          <MessageCircle size={18} strokeWidth={2} className="shrink-0 text-accent-info" />
          <span>{t('chat.title')}</span>
          <UnreadBadge initial={unreadChatCount} />
        </Link>
        <Link href="/team/herausforderungen" className={ACTION_BTN}>
          <Trophy size={18} strokeWidth={2} className="shrink-0 text-accent-challenge" />
          <span>{t('challenge.title')}</span>
        </Link>
      </div>

      {notifications.length > 0 && (
        <section className="card accent-primary card-accent flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="section-title">Benachrichtigungen</p>
            <NotificationCount initial={notificationCount} />
          </div>
          {notifications.map((n) => (
            <Link
              key={n.id}
              href={n.message_id ? eventDeepLink(n.message_id) : '/team/chat'}
              className="press flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-surface-1 px-3 py-2.5"
            >
              {n.kind === 'mention' ? (
                <AtSign size={15} className="mt-0.5 shrink-0 text-brand" />
              ) : n.kind === 'reply' ? (
                <MessageCircle size={15} className="mt-0.5 shrink-0 text-brand" />
              ) : (
                <Heart size={15} className="mt-0.5 shrink-0 fill-current text-brand" />
              )}
              <div className="min-w-0 flex-1">
                <p className={`break-words text-sm ${n.read_at ? 'text-neutral-500' : 'font-semibold text-neutral-900'}`}>
                  {inAppNotificationText(n.kind, n.params)}
                </p>
                {(n.kind === 'reply' || n.kind === 'mention') && n.params.preview && (
                  <p className="truncate text-xs text-neutral-500">„{stripMarkdown(n.params.preview)}“</p>
                )}
              </div>
              {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-label="Ungelesen" />}
            </Link>
          ))}
          <ChatPushPrompt variant="support" />
        </section>
      )}

      {/* Ranking */}
      <section className="card accent-team card-accent">
        <div className="mb-3 flex items-center justify-between">
          <p className="section-title">{t('team.ranking')}</p>
          {myRankIndex >= 0 && <p className="text-xs font-semibold text-brand">{t('ranking.yourRank')}: #{myRankIndex + 1}</p>}
        </div>
        {rankingRules && (
          <div className="-mt-1 mb-3">
            <PointsRulesSheet rules={rankingRules} />
          </div>
        )}

        <div className="scrollbar-hide -mx-1 mb-4 flex gap-2 overflow-x-auto px-1">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`/team?period=${p}`}
              className={clsx('pill', p === period ? 'pill-active' : 'pill-inactive')}
            >
              {t(`ranking.period.${p}` as const)}
            </Link>
          ))}
        </div>

        {ranking.every((r) => r.points === 0) ? (
          <p className="py-4 text-center text-sm text-neutral-500">{t('ranking.empty')}</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {ranking.map((r, i) => (
              <li
                key={r.userId}
                className={clsx(
                  'flex items-center gap-3 rounded-xl px-2 py-2.5',
                  r.userId === user.id && 'bg-brand/[0.1] ring-1 ring-brand/30'
                )}
              >
                <span
                  style={i < 3 ? { background: ['linear-gradient(180deg,#f7cf7a,#e8a93a)', 'linear-gradient(180deg,#9fdcff,#5fb8ee)', 'linear-gradient(180deg,#f0a86a,#d9803a)'][i] } : undefined}
                  className={clsx(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums',
                    i === 0 ? 'text-[#2a1c00]' : i === 1 ? 'text-[#06202b]' : i === 2 ? 'text-[#2b1400]' : 'text-neutral-500'
                  )}
                >
                  {i + 1}
                </span>
                <Avatar src={r.avatarUrl} name={r.fullName} size="sm" />
                <span className="flex-1 truncate text-sm font-medium text-neutral-900">{r.fullName}</span>
                <span className="text-sm font-bold tabular-nums text-neutral-900">{r.points}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Challenge */}
      <section className="card accent-challenge card-accent">
        <p className="section-title mb-3">{t('team.currentChallenge')}</p>
        {activeChallenge ? (
          <div>
            <p className="text-base font-bold text-neutral-900">{activeChallenge.title}</p>
            <div className="mt-2">
              <ProgressBar tone="challenge" percent={(activeChallenge.myProgress / activeChallenge.target_value) * 100} />
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              {t('challenge.progress', { current: Math.round(activeChallenge.myProgress), target: activeChallenge.target_value })} ·{' '}
              {t('challenge.deadline', { date: formatGermanDate(activeChallenge.ends_at) })}
            </p>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">{t('challenge.empty.title')}</p>
        )}
      </section>

      {/* Activity feed */}
      <section className="card-quiet">
        <p className="section-title mb-3">{t('team.recentActivity')}</p>
        {feed.length === 0 ? (
          <p className="text-sm text-neutral-500">{t('feed.empty.title')}</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {feed.map((item) => (
              <li key={item.id} className="border-l-2 border-brand/30 pl-3 text-sm text-neutral-700">
                {renderFeedItem(item)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
