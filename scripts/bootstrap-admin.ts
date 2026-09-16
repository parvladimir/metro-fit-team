/**
 * Manual/ops entry point for the initial-admin bootstrap. In normal
 * operation this happens automatically the first time the configured
 * INITIAL_ADMIN_EMAIL signs in (see src/lib/server/bootstrap.ts) — this
 * script exists for cases where you want to run it explicitly (e.g. right
 * after a fresh deploy, before Thorsten has logged in for the first time,
 * to confirm the team already exists) or to re-verify idempotency.
 *
 * Usage: npm run bootstrap:admin
 */
import { getAdminClient, getEnv, slugify } from './lib';

async function main() {
  const { initialAdminEmail, initialTeamName } = getEnv();
  if (!initialAdminEmail) {
    console.error('INITIAL_ADMIN_EMAIL is not set — nothing to do.');
    process.exit(1);
  }

  const admin = getAdminClient();
  const slug = slugify(initialTeamName);

  const { data: existingTeam } = await admin.from('teams').select('id, name').eq('slug', slug).maybeSingle();

  let teamId = existingTeam?.id as string | undefined;

  // Find the auth user by email (paginated search — fine for small teams).
  let targetUserId: string | undefined;
  let page = 1;
  while (!targetUserId) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === initialAdminEmail);
    if (match) {
      if (!match.email_confirmed_at) {
        console.log(`Found ${initialAdminEmail}, but the email is not confirmed yet. Nothing to do until they verify it.`);
        return;
      }
      targetUserId = match.id;
      break;
    }
    if (data.users.length < 200) break;
    page += 1;
  }

  if (!targetUserId) {
    console.log(`${initialAdminEmail} has not registered yet. Bootstrap will run automatically once they sign up and confirm their email.`);
    return;
  }

  if (!teamId) {
    const { data: newTeam, error } = await admin
      .from('teams')
      .insert({ name: initialTeamName, slug, created_by: targetUserId })
      .select('id')
      .single();
    if (error) throw error;
    teamId = newTeam.id;
    console.log(`Created team "${initialTeamName}" (${teamId}).`);
  } else {
    console.log(`Team "${initialTeamName}" already exists (${teamId}).`);
  }

  const { data: membership } = await admin
    .from('team_members')
    .select('id, role')
    .eq('team_id', teamId)
    .eq('user_id', targetUserId)
    .maybeSingle();

  if (!membership) {
    await admin.from('team_members').insert({ team_id: teamId, user_id: targetUserId, role: 'team_admin' });
    console.log(`Added ${initialAdminEmail} as team_admin.`);
  } else if (membership.role !== 'team_admin') {
    await admin.from('team_members').update({ role: 'team_admin' }).eq('id', membership.id);
    console.log(`Promoted ${initialAdminEmail} to team_admin.`);
  } else {
    console.log(`${initialAdminEmail} is already team_admin. Nothing to do (idempotent).`);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
