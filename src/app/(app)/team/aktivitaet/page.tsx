import clsx from 'clsx';
import Link from 'next/link';
import { Users } from 'lucide-react';
import { BackLink } from '@/components/ui/BackLink';
import { EmptyState } from '@/components/ui/EmptyState';
import { requireAuthUser, getPrimaryTeamMembership } from '@/lib/data/profile';
import { getTeamActivity, type TeamActivityPeriod } from '@/lib/data/team-activity';
import { getMessageReactions } from '@/lib/data/chat';
import { TeamActivityList } from '@/components/team/TeamActivityList';

const PERIODS: TeamActivityPeriod[] = ['today', 'yesterday', 'week'];
const PERIOD_LABEL: Record<TeamActivityPeriod, string> = { today: 'Heute', yesterday: 'Gestern', week: 'Diese Woche' };

export default async function TeamActivityPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period: periodParam } = await searchParams;
  const period = PERIODS.includes(periodParam as TeamActivityPeriod) ? (periodParam as TeamActivityPeriod) : 'today';

  const user = await requireAuthUser();
  const membership = await getPrimaryTeamMembership(user.id);

  if (!membership) {
    return (
      <div className="screen-padding flex flex-col gap-4 pb-4">
        <div className="flex items-center gap-3">
          <BackLink href="/" />
          <h1 className="text-xl font-bold text-neutral-900">Team-Aktivität</h1>
        </div>
        <EmptyState title="Du bist noch in keinem Team." icon={Users} accent="team" />
      </div>
    );
  }

  const summary = await getTeamActivity(membership.team_id, period);
  const reactions = await getMessageReactions(summary.members.flatMap((m) => m.workouts.map((w) => w.messageId)));

  return (
    <div className="screen-padding flex flex-col gap-4 pb-8">
      <div className="flex items-center gap-3">
        <BackLink href="/" />
        <h1 className="text-xl font-bold text-neutral-900">Team-Aktivität</h1>
      </div>

      <div className="scrollbar-hide -mx-1 flex gap-2 overflow-x-auto px-1">
        {PERIODS.map((p) => (
          <Link key={p} href={`/team/aktivitaet?period=${p}`} className={clsx('pill', p === period ? 'pill-active' : 'pill-inactive')}>
            {PERIOD_LABEL[p]}
          </Link>
        ))}
      </div>

      <TeamActivityList summary={summary} initialReactions={reactions} currentUserId={user.id} />
    </div>
  );
}
