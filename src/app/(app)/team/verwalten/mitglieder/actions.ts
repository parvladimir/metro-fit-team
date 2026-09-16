'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireTeamAdminMembership } from '@/lib/data/admin';

export async function setMemberRoleAction(memberId: string, memberUserId: string, role: 'member' | 'team_admin') {
  'use server';
  const admin = await requireTeamAdminMembership();
  const supabase = await createClient();

  await supabase.from('team_members').update({ role }).eq('id', memberId).eq('team_id', admin.team_id);

  await supabase.from('audit_events').insert({
    team_id: admin.team_id,
    actor_user_id: admin.user_id,
    action: role === 'team_admin' ? 'member_promoted_team_admin' : 'member_demoted_member',
    entity_type: 'team_member',
    entity_id: memberUserId,
  });

  revalidatePath('/team/verwalten/mitglieder');
}

export async function removeMemberAction(memberId: string, memberUserId: string) {
  'use server';
  const admin = await requireTeamAdminMembership();
  const supabase = await createClient();

  await supabase.from('team_members').delete().eq('id', memberId).eq('team_id', admin.team_id);

  await supabase.from('audit_events').insert({
    team_id: admin.team_id,
    actor_user_id: admin.user_id,
    action: 'member_removed',
    entity_type: 'team_member',
    entity_id: memberUserId,
  });

  revalidatePath('/team/verwalten/mitglieder');
}
