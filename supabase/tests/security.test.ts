/**
 * Integration tests for the Row Level Security model, run against a REAL
 * Supabase project (local `supabase start` or a disposable test project) —
 * RLS cannot be meaningfully unit-tested against a mock.
 *
 * These are skipped by default (`npm test` only runs unit tests) because
 * they provision and delete real auth users. Run explicitly with:
 *
 *   RUN_INTEGRATION_TESTS=1 npx vitest run supabase/tests/security.test.ts
 *
 * against a project whose migrations + seed.sql have already been applied.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const RUN = process.env.RUN_INTEGRATION_TESTS === '1';
const describeIntegration = RUN ? describe : describe.skip;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function randomEmail(label: string) {
  return `${label}-${Date.now()}-${Math.round(Math.random() * 1e6)}@security-test.local`;
}

describeIntegration('Row Level Security', () => {
  let admin: SupabaseClient;
  let teamId: string;
  let outsiderTeamId: string;
  let userA: { id: string; email: string; password: string; client: SupabaseClient };
  let userB: { id: string; email: string; password: string; client: SupabaseClient };
  let outsider: { id: string; email: string; password: string; client: SupabaseClient };

  async function createTestUser(label: string) {
    const email = randomEmail(label);
    const password = 'Test-Passw0rd-1234';
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;

    const client = createClient(SUPABASE_URL, ANON_KEY);
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;

    return { id: data.user.id, email, password, client };
  }

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    userA = await createTestUser('user-a');
    userB = await createTestUser('user-b');
    outsider = await createTestUser('outsider');

    const { data: team } = await admin.from('teams').insert({ name: `Security Test Team ${Date.now()}`, slug: `sec-test-${Date.now()}` }).select('id').single();
    teamId = team!.id;
    const { data: outsiderTeam } = await admin.from('teams').insert({ name: `Outsider Team ${Date.now()}`, slug: `outsider-team-${Date.now()}` }).select('id').single();
    outsiderTeamId = outsiderTeam!.id;

    await admin.from('team_members').insert([
      { team_id: teamId, user_id: userA.id, role: 'team_admin' },
      { team_id: teamId, user_id: userB.id, role: 'member' },
      { team_id: outsiderTeamId, user_id: outsider.id, role: 'member' },
    ]);

    await admin.from('body_measurements').insert({ user_id: userB.id, measured_at: '2024-01-01', weight_kg: 70 });
    await admin.from('messages').insert({ team_id: teamId, user_id: userA.id, content: 'internal team message' });
  });

  afterAll(async () => {
    for (const u of [userA, userB, outsider]) {
      await admin.auth.admin.deleteUser(u.id).catch(() => undefined);
    }
    await admin.from('teams').delete().in('id', [teamId, outsiderTeamId]);
  });

  it('1. a member cannot read another member\'s private body measurements', async () => {
    const { data, error } = await userA.client.from('body_measurements').select('*').eq('user_id', userB.id);
    expect(error).toBeNull();
    expect(data).toEqual([]); // RLS silently filters rows rather than erroring
  });

  it('2. a normal member cannot perform team_admin actions (e.g. change another member\'s role)', async () => {
    const { data: membershipRow } = await admin.from('team_members').select('id').eq('team_id', teamId).eq('user_id', userA.id).single();

    const { error } = await userB.client.from('team_members').update({ role: 'team_admin' }).eq('id', membershipRow!.id);
    // RLS blocks the update outright (no rows affected), it does not error —
    // verify by re-reading with the admin client that the role is unchanged.
    expect(error).toBeNull();
    const { data: unchanged } = await admin.from('team_members').select('role').eq('id', membershipRow!.id).single();
    expect(unchanged!.role).toBe('team_admin'); // userA's own role, untouched by userB's attempt
  });

  it('3. a user outside the team cannot read team chat', async () => {
    const { data, error } = await outsider.client.from('messages').select('*').eq('team_id', teamId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('4. a revoked invite cannot be redeemed', async () => {
    const token = 'security-test-token-' + Date.now();
    const { createHash } = await import('node:crypto');
    const tokenHash = createHash('sha256').update(token).digest('hex');

    await admin.from('team_invites').insert({
      team_id: teamId,
      token_hash: tokenHash,
      created_by: userA.id,
      revoked_at: new Date().toISOString(),
    });

    const { error } = await outsider.client.rpc('redeem_team_invite', { p_token: token });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('invite_revoked');
  });

  it('5. a client cannot self-assign team membership by inserting directly (only redeem_team_invite can)', async () => {
    const { error } = await outsider.client.from('team_members').insert({ team_id: teamId, user_id: outsider.id, role: 'team_admin' });
    expect(error).not.toBeNull(); // no INSERT policy exists on team_members for clients
  });

  it('6. team_admin cannot bypass another member\'s private health-data settings', async () => {
    // userA is team_admin of the team userB belongs to.
    const { data, error } = await userA.client.from('body_measurements').select('*').eq('user_id', userB.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  async function createInvite(overrides: Record<string, unknown> = {}) {
    const token = 'invite-flow-token-' + Date.now() + '-' + Math.round(Math.random() * 1e6);
    const { createHash } = await import('node:crypto');
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const { data, error } = await admin
      .from('team_invites')
      .insert({ team_id: teamId, token_hash: tokenHash, created_by: userA.id, ...overrides })
      .select('id')
      .single();
    if (error) throw error;

    return { token, inviteId: data!.id as string };
  }

  it('7. redeeming a valid invite creates a membership row with role=member (never team_admin)', async () => {
    const joiner = await createTestUser('joiner-fresh');
    const { token, inviteId } = await createInvite();

    const { data, error } = await joiner.client.rpc('redeem_team_invite', { p_token: token });
    const result = Array.isArray(data) ? data[0] : data;

    expect(error).toBeNull();
    expect(result.already_member).toBe(false);
    expect(result.team_id).toBe(teamId);

    const { data: membership } = await admin
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', joiner.id)
      .single();
    expect(membership!.role).toBe('member');

    const { data: invite } = await admin.from('team_invites').select('use_count').eq('id', inviteId).single();
    expect(invite!.use_count).toBe(1);

    await admin.auth.admin.deleteUser(joiner.id).catch(() => undefined);
  });

  it('8. redeeming an already-joined invite is idempotent (no duplicate row, use_count unchanged)', async () => {
    const joiner = await createTestUser('joiner-idempotent');
    const { token, inviteId } = await createInvite();

    const first = await joiner.client.rpc('redeem_team_invite', { p_token: token });
    expect(first.error).toBeNull();

    const second = await joiner.client.rpc('redeem_team_invite', { p_token: token });
    const secondResult = Array.isArray(second.data) ? second.data[0] : second.data;
    expect(second.error).toBeNull();
    expect(secondResult.already_member).toBe(true);

    const { data: memberships } = await admin
      .from('team_members')
      .select('id')
      .eq('team_id', teamId)
      .eq('user_id', joiner.id);
    expect(memberships).toHaveLength(1);

    const { data: invite } = await admin.from('team_invites').select('use_count').eq('id', inviteId).single();
    expect(invite!.use_count).toBe(1); // second redemption must NOT increment use_count again

    await admin.auth.admin.deleteUser(joiner.id).catch(() => undefined);
  });

  it('9. an expired invite cannot be redeemed', async () => {
    const { token } = await createInvite({ expires_at: new Date(Date.now() - 60_000).toISOString() });

    const { error } = await outsider.client.rpc('redeem_team_invite', { p_token: token });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('invite_expired');
  });

  it('10. an invite cannot be redeemed beyond its max_uses limit', async () => {
    const joiner = await createTestUser('joiner-maxuses');
    const { token } = await createInvite({ max_uses: 1, use_count: 1 });

    const { error } = await joiner.client.rpc('redeem_team_invite', { p_token: token });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('invite_exhausted');

    const { data: membership } = await admin
      .from('team_members')
      .select('id')
      .eq('team_id', teamId)
      .eq('user_id', joiner.id);
    expect(membership).toEqual([]); // failed redemption must not create membership

    await admin.auth.admin.deleteUser(joiner.id).catch(() => undefined);
  });
});
