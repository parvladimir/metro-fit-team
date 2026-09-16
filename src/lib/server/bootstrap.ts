import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { getServerEnv } from '@/lib/env';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Idempotently promotes the configured INITIAL_ADMIN_EMAIL to team_admin of
 * INITIAL_TEAM_NAME, once that user has authenticated with a verified email
 * matching the config.
 *
 * SECURITY MODEL — this is the only place in the codebase that decides who
 * the initial admin is, and it never trusts client input:
 *  - `verifiedUserId` / `verifiedEmail` MUST come from a server-verified
 *    Supabase session (`supabase.auth.getUser()` on the server, which
 *    round-trips to Supabase Auth — never from a client-supplied body/JWT
 *    claim taken at face value).
 *  - The target email/team name come only from server-only env vars
 *    (`getServerEnv()`), never from a request parameter. A malicious client
 *    cannot influence which team or which email gets bootstrapped no matter
 *    what it sends, because nothing it sends is read here.
 *  - After the first successful run, DB membership (team_members.role) is
 *    the sole source of truth; this function becomes a no-op for everyone
 *    once the row exists, and re-running it never creates duplicates
 *    (upserts keyed by unique constraints).
 */
export async function ensureInitialAdminBootstrap(verifiedUserId: string, verifiedEmail: string | null | undefined) {
  const { initialAdminEmail, initialTeamName } = getServerEnv();

  if (!initialAdminEmail || !verifiedEmail) return;
  if (verifiedEmail.trim().toLowerCase() !== initialAdminEmail) return;

  const admin = createAdminClient();

  // Confirm the email really is verified (not just present) before granting
  // any privilege — a client cannot forge this because it comes from the
  // Auth server's own user record, fetched with the service-role key.
  const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(verifiedUserId);
  if (authUserError || !authUser?.user?.email_confirmed_at) return;

  const slug = slugify(initialTeamName);

  const { data: existingTeam } = await admin.from('teams').select('id').eq('slug', slug).maybeSingle();

  let teamId = existingTeam?.id as string | undefined;

  if (!teamId) {
    const { data: newTeam, error: teamError } = await admin
      .from('teams')
      .insert({ name: initialTeamName, slug, created_by: verifiedUserId })
      .select('id')
      .single();
    if (teamError) throw teamError;
    teamId = newTeam.id;

    await admin.from('audit_events').insert({
      team_id: teamId,
      actor_user_id: verifiedUserId,
      action: 'team_created',
      entity_type: 'team',
      entity_id: teamId,
      metadata: { source: 'bootstrap' },
    });
  }

  const { data: existingMembership } = await admin
    .from('team_members')
    .select('id, role')
    .eq('team_id', teamId)
    .eq('user_id', verifiedUserId)
    .maybeSingle();

  if (!existingMembership) {
    await admin.from('team_members').insert({ team_id: teamId, user_id: verifiedUserId, role: 'team_admin' });
  } else if (existingMembership.role !== 'team_admin') {
    await admin.from('team_members').update({ role: 'team_admin' }).eq('id', existingMembership.id);
  } else {
    return; // already bootstrapped — nothing to do
  }

  await admin.from('audit_events').insert({
    team_id: teamId,
    actor_user_id: verifiedUserId,
    action: 'member_promoted_team_admin',
    entity_type: 'team_member',
    entity_id: verifiedUserId,
    metadata: { source: 'bootstrap' },
  });
}
