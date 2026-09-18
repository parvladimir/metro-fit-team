import { BackLink } from '@/components/ui/BackLink';
import { requireTeamAdminMembership } from '@/lib/data/admin';
import { getTeamRankingRules } from '@/lib/data/team';
import { updateRankingRulesAction } from './actions';
import { t } from '@/lib/i18n';

export default async function RanglistenregelnPage() {
  const admin = await requireTeamAdminMembership();
  const rules = await getTeamRankingRules(admin.team_id);
  if (!rules) return null;

  return (
    <div className="screen-padding flex flex-col gap-4 pb-8">
      <div className="flex items-center gap-3">
        <BackLink href="/team/verwalten" />
        <h1 className="text-xl font-bold text-neutral-900">{t('admin.rankingRules')}</h1>
      </div>
      <p className="text-xs text-neutral-500">{t('admin.rankingRules.description')}</p>

      <form action={updateRankingRulesAction} className="flex flex-col gap-4">
        <Field label={t('admin.rankingRules.pointsWorkoutCompleted')} name="pointsWorkoutCompleted" defaultValue={rules.points_workout_completed} />
        <Field label={t('admin.rankingRules.pointsDurationBonus', { minutes: rules.duration_bonus_threshold_minutes })} name="pointsDurationBonus" defaultValue={rules.points_duration_bonus} />
        <Field label="Schwelle für Dauer-Bonus (Min.)" name="durationBonusThresholdMinutes" defaultValue={rules.duration_bonus_threshold_minutes} />
        <Field label={t('admin.rankingRules.pointsWeeklyGoalReached')} name="pointsWeeklyGoalReached" defaultValue={rules.points_weekly_goal_reached} />
        <Field label={t('admin.rankingRules.pointsConsistencyBonus')} name="pointsConsistencyBonus" defaultValue={rules.points_consistency_bonus} />
        <Field label="Mindesttage für Konsistenz-Bonus" name="consistencyBonusMinDays" defaultValue={rules.consistency_bonus_min_days} />
        <Field label={t('admin.rankingRules.pointsDailyStepGoal')} name="pointsDailyStepGoal" defaultValue={rules.points_daily_step_goal} />
        <Field label="Punkte für abgeschlossene Einzel-Challenge" name="pointsChallengeCompleted" defaultValue={rules.points_challenge_completed} />
        <Field label="Punkte für Team-Challenge-Teilnahme" name="pointsTeamChallengeParticipation" defaultValue={rules.points_team_challenge_participation} />
        <Field label={t('admin.rankingRules.dailyCap')} name="dailyCapPoints" defaultValue={rules.daily_cap_points} />

        <button type="submit" className="btn-primary">{t('common.saveChanges')}</button>
      </form>
    </div>
  );
}

function Field({ label, name, defaultValue }: { label: string; name: string; defaultValue: number }) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} type="number" min={0} defaultValue={defaultValue} className="input-field" />
    </div>
  );
}
