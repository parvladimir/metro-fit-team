import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { TeamInvite } from '@/types/database';

export async function getTeamInvites(teamId: string): Promise<TeamInvite[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('team_invites')
    .select('*')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false });
  return (data ?? []) as TeamInvite[];
}

export function isInviteActive(invite: TeamInvite): boolean {
  if (invite.revoked_at) return false;
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) return false;
  if (invite.max_uses !== null && invite.use_count >= invite.max_uses) return false;
  return true;
}
