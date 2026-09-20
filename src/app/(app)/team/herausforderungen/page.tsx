import Link from 'next/link';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Trophy } from 'lucide-react';
import { BackLink } from '@/components/ui/BackLink';
import { requireAuthUser, getPrimaryTeamMembership } from '@/lib/data/profile';
import { getTeamChallenges } from '@/lib/data/challenges';
import { joinChallengeAction } from './actions';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatGermanDate } from '@/lib/date';
import { t } from '@/lib/i18n';

export default async function HerausforderungenPage() {
  const user = await requireAuthUser();
  const membership = await getPrimaryTeamMembership(user.id);

  if (!membership) {
    return (
      <div className="screen-padding pb-4">
        <EmptyState title={t('team.noTeam.title')} icon={Trophy} accent="challenge" />
      </div>
    );
  }

  const challenges = await getTeamChallenges(membership.team_id, user.id);
  const isAdmin = membership.role === 'team_admin';

  return (
    <div className="screen-padding flex flex-col gap-4 pb-4">
      <div className="flex items-center gap-3">
        <BackLink href="/team" />
        <h1 className="text-xl font-bold text-neutral-900">{t('challenge.title')}</h1>
      </div>

      {isAdmin && (
        <Link href="/team/herausforderungen/neu" className="btn-primary">{t('challenge.create')}</Link>
      )}

      {challenges.length === 0 ? (
        <EmptyState title={t('challenge.empty.title')} actionLabel={isAdmin ? t('challenge.empty.action') : undefined} actionHref="/team/herausforderungen/neu" icon={Trophy} accent="challenge" />
      ) : (
        <div className="flex flex-col gap-3">
          {challenges.map((c) => (
            <div key={c.id} className={`card card-accent ${c.isCompleted ? 'accent-success' : 'accent-challenge'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-base font-bold text-neutral-900">{c.title}</p>
                  {c.description && <p className="mt-0.5 text-xs text-neutral-500">{c.description}</p>}
                </div>
                <span className="shrink-0 rounded-full border border-white/10 bg-surface-3 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">
                  {t(`challenge.type.${c.challenge_type}` as const)}
                </span>
              </div>

              <div className="mt-3">
                <ProgressBar tone={c.isCompleted ? 'success' : 'challenge'} percent={(c.myProgress / c.target_value) * 100} />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-xs text-neutral-500">
                <span>{t('challenge.progress', { current: Math.round(c.myProgress), target: c.target_value })}</span>
                <span>{t('challenge.deadline', { date: formatGermanDate(c.ends_at) })}</span>
              </div>

              {c.isCompleted && <p className="mt-2 text-sm font-semibold text-accent-success">{t('challenge.completed')}</p>}

              {c.challenge_type === 'individual' && !c.isCompleted && (
                <form action={joinChallengeAction.bind(null, c.id)} className="mt-3">
                  <button type="submit" className="btn-secondary w-full text-sm">{t('challenge.participants')}: {c.participantCount}</button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
