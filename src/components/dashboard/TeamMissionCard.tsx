import Link from 'next/link';
import { ProgressBar } from '@/components/ui/ProgressBar';
import type { TeamMissionWithProgress } from '@/lib/data/team-missions';

/** "Unsere Wochenmission" — compact Home card. Renders nothing when no
 * mission is active, so it never occupies space for an empty state (unlike
 * "Heute im Team"/"Dein Platz", which always show a fair empty state — a
 * cooperative goal that doesn't exist yet has nothing worth saying about it
 * on Home; the full /team/mission page still offers to create one). */
export function TeamMissionCard({ mission }: { mission: TeamMissionWithProgress | null }) {
  if (!mission) return null;

  return (
    <Link href="/team/mission" className={`card card-accent press ${mission.isCompleted ? 'accent-success' : 'accent-challenge'}`}>
      <p className="section-title mb-2">Unsere Wochenmission</p>
      <p className="text-sm font-bold text-neutral-900">{mission.title}</p>
      <div className="mt-2">
        <ProgressBar tone={mission.isCompleted ? 'success' : 'challenge'} percent={(mission.trainingDays / mission.target_days) * 100} />
      </div>
      <p className="mt-1.5 text-xs text-neutral-500">
        {mission.justCelebrated
          ? 'Gemeinsam geschafft! 🎉'
          : `${mission.trainingDays} / ${mission.target_days} Trainingstage`}
      </p>
    </Link>
  );
}
