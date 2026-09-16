import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Challenge, ChallengeParticipant } from '@/types/database';

export interface ChallengeWithProgress extends Challenge {
  myProgress: number;
  participantCount: number;
  isCompleted: boolean;
}

export async function getTeamChallenges(teamId: string, userId: string): Promise<ChallengeWithProgress[]> {
  const supabase = await createClient();
  const { data: challenges } = await supabase
    .from('challenges')
    .select('*')
    .eq('team_id', teamId)
    .order('ends_at', { ascending: false });

  if (!challenges || challenges.length === 0) return [];

  const { data: participants } = await supabase
    .from('challenge_participants')
    .select('*')
    .in('challenge_id', challenges.map((c) => c.id));

  const rows = (participants ?? []) as ChallengeParticipant[];

  return (challenges as Challenge[]).map((c) => {
    const forChallenge = rows.filter((p) => p.challenge_id === c.id);
    const mine = forChallenge.find((p) => p.user_id === userId);
    const myProgress = c.challenge_type === 'team'
      ? forChallenge.reduce((sum, p) => sum + Number(p.progress_value), 0)
      : Number(mine?.progress_value ?? 0);

    return {
      ...c,
      myProgress,
      participantCount: forChallenge.length,
      isCompleted: c.challenge_type === 'team' ? myProgress >= c.target_value : !!mine?.completed_at,
    };
  });
}
