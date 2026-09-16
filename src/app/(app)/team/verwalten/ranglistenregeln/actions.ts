'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireTeamAdminMembership } from '@/lib/data/admin';

export async function updateRankingRulesAction(formData: FormData) {
  const admin = await requireTeamAdminMembership();
  const supabase = await createClient();

  const numeric = (key: string) => Number(formData.get(key));

  await supabase
    .from('team_ranking_rules')
    .update({
      points_workout_completed: numeric('pointsWorkoutCompleted'),
      points_duration_bonus: numeric('pointsDurationBonus'),
      duration_bonus_threshold_minutes: numeric('durationBonusThresholdMinutes'),
      points_weekly_goal_reached: numeric('pointsWeeklyGoalReached'),
      points_consistency_bonus: numeric('pointsConsistencyBonus'),
      consistency_bonus_min_days: numeric('consistencyBonusMinDays'),
      points_daily_step_goal: numeric('pointsDailyStepGoal'),
      points_challenge_completed: numeric('pointsChallengeCompleted'),
      points_team_challenge_participation: numeric('pointsTeamChallengeParticipation'),
      daily_cap_points: numeric('dailyCapPoints'),
      updated_by: admin.user_id,
    })
    .eq('team_id', admin.team_id);

  await supabase.from('audit_events').insert({
    team_id: admin.team_id,
    actor_user_id: admin.user_id,
    action: 'ranking_rules_updated',
    entity_type: 'team_ranking_rules',
  });

  revalidatePath('/team/verwalten/ranglistenregeln');
}
