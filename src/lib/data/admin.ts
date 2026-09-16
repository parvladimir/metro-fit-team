import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAuthUser, getPrimaryTeamMembership, type TeamMembership } from '@/lib/data/profile';
import type { AuditEvent } from '@/types/database';

/**
 * Redirects away if the current user is not a team_admin. This is a UX
 * convenience only — the real enforcement is the `team_admin`-scoped RLS
 * policies on every mutation below, so a crafted request bypassing this
 * check still cannot perform an admin action.
 */
export async function requireTeamAdminMembership(): Promise<TeamMembership> {
  const user = await requireAuthUser();
  const membership = await getPrimaryTeamMembership(user.id);
  if (!membership || membership.role !== 'team_admin') {
    redirect('/team');
  }
  return membership;
}

export async function getAuditLog(teamId: string, limit = 40): Promise<AuditEvent[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('audit_events')
    .select('*')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as AuditEvent[];
}
