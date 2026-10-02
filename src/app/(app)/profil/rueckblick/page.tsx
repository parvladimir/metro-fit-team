import { BackLink } from '@/components/ui/BackLink';
import { Avatar } from '@/components/ui/Avatar';
import { requireAuthUser, getCurrentProfile, getPrimaryTeamMembership } from '@/lib/data/profile';
import { ensureWeeklyRecapGenerated } from '@/lib/data/weekly-recap';
import { getTeamRankingWithProfiles, computeRanks, isUnrankedTie, type RankedScoreRow } from '@/lib/data/team';
import { formatDurationWords } from '@/lib/workout-metrics';

type PodiumRow = RankedScoreRow & { fullName: string; avatarUrl: string | null };

export default async function WochenrueckblickPage() {
  const user = await requireAuthUser();
  const [profile, membership] = await Promise.all([getCurrentProfile(), getPrimaryTeamMembership(user.id)]);
  if (!profile) return null;

  const teamId = membership?.team_id ?? null;

  let personal: Awaited<ReturnType<typeof ensureWeeklyRecapGenerated>>['personal'] = null;
  let team: Awaited<ReturnType<typeof ensureWeeklyRecapGenerated>>['team'] = null;
  try {
    const result = await ensureWeeklyRecapGenerated(profile, teamId);
    personal = result.personal;
    team = result.team;
  } catch {
    // Degrade gracefully — the page still renders, just without last week's numbers.
  }

  let podium: PodiumRow[] = [];
  if (teamId) {
    const rankingRows = await getTeamRankingWithProfiles(teamId, 'last_week');
    if (!isUnrankedTie(rankingRows)) {
      podium = (computeRanks(rankingRows) as PodiumRow[]).slice(0, 3);
    }
  }

  return (
    <div className="screen-padding flex flex-col gap-4 pb-8">
      <div className="flex items-center gap-3">
        <BackLink href="/profil" />
        <h1 className="text-xl font-bold text-neutral-900">Wochenrückblick</h1>
      </div>

      <section className="card accent-primary card-accent">
        <p className="section-title mb-3">Deine Woche</p>
        {!personal ? (
          <p className="text-sm text-neutral-500">Für letzte Woche liegt noch kein Rückblick vor.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-semibold text-neutral-900">
              {personal.completed_workouts} {personal.completed_workouts === 1 ? 'Training' : 'Trainings'} · {formatDurationWords(personal.minutes * 60)}
            </p>
            {personal.goal_achieved && <p className="text-sm font-semibold text-accent-success">Wochenziel erreicht! 🎉</p>}
            {personal.personal_record_title && (
              <p className="text-sm font-semibold text-accent-achievement">
                {personal.personal_record_title} {personal.personal_record_detail}
              </p>
            )}
            {personal.streak_days >= 3 && <p className="text-xs text-neutral-500">{personal.streak_days} Tage in Folge aktiv 🔥</p>}
            <p className="mt-1 text-xs text-neutral-500">{personal.points} Wettbewerbspunkte</p>
          </div>
        )}
      </section>

      {teamId && (
        <section className="card accent-team card-accent">
          <p className="section-title mb-3">Starke Woche, Team!</p>
          {!team ? (
            <p className="text-sm text-neutral-500">Für letzte Woche liegt noch keine Team-Zusammenfassung vor.</p>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="text-sm text-neutral-700">{team.active_members} Mitglieder waren aktiv.</p>
              <p className="text-sm text-neutral-700">{team.members_goal_reached} haben ihr Wochenziel erreicht.</p>
              <p className="text-sm text-neutral-700">{team.completed_workouts} abgeschlossene Trainings.</p>
            </div>
          )}

          {podium.length > 0 && (
            <ol className="mt-4 flex flex-col gap-1 border-t border-white/[0.08] pt-3">
              {podium.map((r) => (
                <li key={r.userId} className={`flex items-center gap-2 rounded-lg px-1.5 py-1 ${r.userId === user.id ? 'bg-brand/[0.1]' : ''}`}>
                  <span className="w-4 shrink-0 text-center text-xs font-bold tabular-nums text-neutral-500">{r.rank}</span>
                  <Avatar src={r.avatarUrl} name={r.fullName} size="sm" className="!h-5 !w-5 !text-[9px]" />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-900">{r.fullName}</span>
                  <span className="shrink-0 text-xs font-bold tabular-nums text-neutral-900">{r.points}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}
