import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Profile, TeamMember, TeamRankingRules } from '@/types/database';

export interface RosterEntry extends TeamMember {
  profile: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>;
}

export async function getTeamRoster(teamId: string): Promise<RosterEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('team_members')
    .select('*, profiles(id, full_name, avatar_url)')
    .eq('team_id', teamId)
    .order('joined_at', { ascending: true });

  return (data ?? []).map((row) => {
    const r = row as unknown as TeamMember & { profiles: Profile };
    return { ...r, profile: r.profiles };
  });
}

export type RankingPeriod = 'current_week' | 'last_week' | 'current_month' | 'all_time';

export interface RankingRow {
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  points: number;
}

export async function getTeamRankingWithProfiles(teamId: string, period: RankingPeriod): Promise<RankingRow[]> {
  const supabase = await createClient();
  const { data: rows } = await supabase.rpc('get_team_ranking', { p_team_id: teamId, p_period: period });
  const scoreRows = (rows ?? []) as { user_id: string; points: number }[];

  if (scoreRows.length === 0) {
    // Still show all members with 0 points so the roster isn't empty.
    const roster = await getTeamRoster(teamId);
    return roster
      .map((m) => ({ userId: m.user_id, fullName: m.profile.full_name || '—', avatarUrl: m.profile.avatar_url, points: 0 }))
      .sort((a, b) => b.points - a.points);
  }

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url')
    .in('id', scoreRows.map((r) => r.user_id));

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  return scoreRows
    .map((r) => ({
      userId: r.user_id,
      fullName: profileMap.get(r.user_id)?.full_name || '—',
      avatarUrl: profileMap.get(r.user_id)?.avatar_url ?? null,
      points: Number(r.points),
    }))
    .sort((a, b) => b.points - a.points);
}

export async function getTeamRankingRules(teamId: string): Promise<TeamRankingRules | null> {
  const supabase = await createClient();
  const { data } = await supabase.from('team_ranking_rules').select('*').eq('team_id', teamId).maybeSingle();
  return data as TeamRankingRules | null;
}
