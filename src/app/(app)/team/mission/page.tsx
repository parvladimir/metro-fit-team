import Link from 'next/link';
import { Users } from 'lucide-react';
import { BackLink } from '@/components/ui/BackLink';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { ConfirmSubmitButton } from '@/components/ui/ConfirmSubmitButton';
import { requireAuthUser, getPrimaryTeamMembership } from '@/lib/data/profile';
import { getCurrentTeamMission } from '@/lib/data/team-missions';
import { cancelMissionAction } from './actions';
import { formatGermanDate } from '@/lib/date';

export default async function WochenmissionPage() {
  const user = await requireAuthUser();
  const membership = await getPrimaryTeamMembership(user.id);

  if (!membership) {
    return (
      <div className="screen-padding pb-4">
        <EmptyState title="Du bist noch in keinem Team." icon={Users} accent="team" />
      </div>
    );
  }

  const isAdmin = membership.role === 'team_admin';
  const mission = await getCurrentTeamMission(membership.team_id);

  return (
    <div className="screen-padding flex flex-col gap-4 pb-4">
      <div className="flex items-center gap-3">
        <BackLink href="/team" />
        <h1 className="text-xl font-bold text-neutral-900">Unsere Wochenmission</h1>
      </div>

      {isAdmin && !mission && (
        <Link href="/team/mission/neu" className="btn-primary">Wochenmission erstellen</Link>
      )}

      {!mission ? (
        <EmptyState
          title="Gerade keine gemeinsame Mission aktiv."
          actionLabel={isAdmin ? 'Wochenmission erstellen' : undefined}
          actionHref="/team/mission/neu"
          icon={Users}
          accent="challenge"
        />
      ) : (
        <div className={`card card-accent ${mission.isCompleted ? 'accent-success' : 'accent-challenge'}`}>
          <p className="text-base font-bold text-neutral-900">{mission.title}</p>

          <div className="mt-3">
            <ProgressBar tone={mission.isCompleted ? 'success' : 'challenge'} percent={(mission.trainingDays / mission.target_days) * 100} />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs text-neutral-500">
            <span>{mission.trainingDays} / {mission.target_days} Trainingstage</span>
            <span>bis {formatGermanDate(mission.ends_at)}</span>
          </div>

          {mission.justCelebrated ? (
            <p className="mt-2 text-sm font-semibold text-accent-success">Gemeinsam geschafft! 🎉</p>
          ) : !mission.isCompleted ? (
            <p className="mt-2 text-xs text-neutral-500">
              Noch {Math.max(0, mission.target_days - mission.trainingDays)} Trainingstage bis zum gemeinsamen Ziel.
            </p>
          ) : null}

          <p className="mt-3 text-[11px] text-neutral-400">Fortschritt wird live berechnet — bei jedem Aufruf neu.</p>

          {isAdmin && (
            <form action={cancelMissionAction.bind(null, mission.id)} className="mt-3">
              <ConfirmSubmitButton
                className="btn-secondary w-full text-sm"
                confirmMessage="Wochenmission wirklich abbrechen? Das kann nicht rückgängig gemacht werden."
              >
                Mission abbrechen
              </ConfirmSubmitButton>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
