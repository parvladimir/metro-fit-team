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

export interface InviteEmailRow {
  id: string;
  email: string;
  status: 'sent' | 'failed';
  created_at: string;
}

/** Admin-only by RLS (team_invite_emails_admin_select) — ordinary members get an empty list. */
export async function getInviteEmails(teamId: string, limit = 10): Promise<InviteEmailRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('team_invite_emails')
    .select('id, email, status, created_at')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as InviteEmailRow[];
}
