'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireTeamAdminMembership } from '@/lib/data/admin';

export async function updateTeamSettingsAction(formData: FormData) {
  const admin = await requireTeamAdminMembership();
  const supabase = await createClient();

  const name = String(formData.get('name') || '').trim();
  if (!name) return;

  await supabase.from('teams').update({ name }).eq('id', admin.team_id);

  await supabase.from('audit_events').insert({
    team_id: admin.team_id,
    actor_user_id: admin.user_id,
    action: 'team_settings_updated',
    entity_type: 'team',
    entity_id: admin.team_id,
    metadata: { name },
  });

  revalidatePath('/team/verwalten/einstellungen');
  revalidatePath('/team');
}
