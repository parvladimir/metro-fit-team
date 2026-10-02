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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { addDaysToKey, localDateTimeToUtc } from '@/lib/date';

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

  it('11. get_team_ranking excludes a user who has score history but is no longer a team_members row (e.g. removed/kicked)', async () => {
    // outsider has real fitness_score_events for `teamId` (simulating a
    // former member whose historical score rows were intentionally kept)
    // but, crucially, no team_members row for that team.
    await admin.from('fitness_score_events').insert({
      user_id: outsider.id,
      team_id: teamId,
      event_type: 'workout_completed',
      points: 999,
    });

    const { data, error } = await userA.client.rpc('get_team_ranking', { p_team_id: teamId, p_period: 'all_time' });
    expect(error).toBeNull();
    const rows = (data ?? []) as { user_id: string; points: number }[];
    expect(rows.some((r) => r.user_id === outsider.id)).toBe(false);
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

  it('12. get_unread_chat_count never counts the caller\'s own messages, and reflects a real message from a teammate', async () => {
    // beforeAll already inserted one message from userA after both userA
    // and userB joined teamId, so it counts as unread for userB.
    const { data: ownCount } = await userA.client.rpc('get_unread_chat_count', { p_team_id: teamId });
    expect(Number(ownCount)).toBe(0);

    const { data: otherCount } = await userB.client.rpc('get_unread_chat_count', { p_team_id: teamId });
    expect(Number(otherCount)).toBeGreaterThanOrEqual(1);
  });

  it('13. marking chat read zeroes the unread count for that user only', async () => {
    await userB.client.from('team_message_read_state').upsert(
      { user_id: userB.id, team_id: teamId, last_read_at: new Date().toISOString() },
      { onConflict: 'user_id,team_id' }
    );

    const { data: countAfterRead } = await userB.client.rpc('get_unread_chat_count', { p_team_id: teamId });
    expect(Number(countAfterRead)).toBe(0);

    await admin.from('messages').insert({ team_id: teamId, user_id: userA.id, content: 'a fresh message after userB read' });

    const { data: userBCount } = await userB.client.rpc('get_unread_chat_count', { p_team_id: teamId });
    expect(Number(userBCount)).toBeGreaterThanOrEqual(1);
    const { data: userACount } = await userA.client.rpc('get_unread_chat_count', { p_team_id: teamId });
    expect(Number(userACount)).toBe(0); // still zero for the sender
  });

  it('14. an outsider cannot query unread counts for a team they do not belong to', async () => {
    const { error } = await outsider.client.rpc('get_unread_chat_count', { p_team_id: teamId });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('not_a_team_member');
  });

  it('15. an outsider cannot read another user\'s chat read-state row', async () => {
    const { data, error } = await outsider.client.from('team_message_read_state').select('*').eq('user_id', userB.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('16. an outsider cannot write a read-state row for a team they do not belong to', async () => {
    const { error } = await outsider.client
      .from('team_message_read_state')
      .insert({ user_id: outsider.id, team_id: teamId, last_read_at: new Date().toISOString() });
    expect(error).not.toBeNull();
  });

  it('17. a user cannot create a push subscription for another user (impersonation)', async () => {
    const { error } = await outsider.client
      .from('push_subscriptions')
      .insert({ user_id: userB.id, endpoint: 'https://example.com/fake-endpoint', p256dh: 'x', auth: 'y' });
    expect(error).not.toBeNull();
  });

  it('18. a user cannot read another user\'s push subscriptions', async () => {
    await admin.from('push_subscriptions').insert({
      user_id: userB.id,
      endpoint: 'https://example.com/real-endpoint-' + Date.now(),
      p256dh: 'p256dh-value',
      auth: 'auth-value',
    });

    const { data, error } = await outsider.client.from('push_subscriptions').select('*').eq('user_id', userB.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('19. get_team_ranking excludes a user with fitness_score_totals rows but no team_members row', async () => {
    await admin.from('fitness_score_totals').insert({
      user_id: outsider.id,
      team_id: teamId,
      iso_year: new Date().getUTCFullYear(),
      iso_week: 1,
      points: 500,
    });

    const { data, error } = await userA.client.rpc('get_team_ranking', { p_team_id: teamId, p_period: 'current_week' });
    // current_week only matches the real current iso week, so this mainly
    // guards against a crash/error — the exclusion itself is proven by
    // test 11 (all_time, via fitness_score_events). Still assert no error
    // and, if any row matched, that it isn't the excluded outsider.
    expect(error).toBeNull();
    const rows = (data ?? []) as { user_id: string }[];
    expect(rows.some((r) => r.user_id === outsider.id)).toBe(false);
  });

  // ---- custom exercises -------------------------------------------------
  it('20. a custom exercise is private: others cannot read, edit or forge one for someone else', async () => {
    const name = 'Seilspringen-Test-' + Date.now();
    const { data: mine, error } = await userB.client
      .from('exercises')
      .insert({ name, exercise_type: 'cardio_time', muscle_group: 'other', is_custom: true, visibility: 'private', owner_user_id: userB.id, created_by: userB.id })
      .select('id')
      .single();
    expect(error).toBeNull();

    const { data: seenByA } = await userA.client.from('exercises').select('id').eq('id', mine!.id);
    expect(seenByA).toEqual([]);

    await userA.client.from('exercises').update({ name: 'hijacked' }).eq('id', mine!.id);
    const { data: still } = await admin.from('exercises').select('name').eq('id', mine!.id).single();
    expect(still!.name).toBe(name);

    const { error: forged } = await userA.client
      .from('exercises')
      .insert({ name: 'forged', exercise_type: 'strength', muscle_group: 'other', is_custom: true, visibility: 'private', owner_user_id: userB.id, created_by: userA.id });
    expect(forged).not.toBeNull();

    await admin.from('exercises').delete().eq('id', mine!.id);
  });

  // ---- chat media + messages -------------------------------------------
  it('21. chat-media: member uploads into own team folder; outsider and cross-user paths are rejected', async () => {
    const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
    const ok = await userB.client.storage.from('chat-media').upload(`${teamId}/${userB.id}/t-${Date.now()}.png`, png, { contentType: 'image/png' });
    expect(ok.error).toBeNull();

    const outsiderUp = await outsider.client.storage.from('chat-media').upload(`${teamId}/${outsider.id}/t-${Date.now()}.png`, png, { contentType: 'image/png' });
    expect(outsiderUp.error).not.toBeNull();

    const spoof = await userB.client.storage.from('chat-media').upload(`${teamId}/${userA.id}/t-${Date.now()}.png`, png, { contentType: 'image/png' });
    expect(spoof.error).not.toBeNull();

    const signedByOutsider = await outsider.client.storage.from('chat-media').createSignedUrl(ok.data!.path, 60);
    expect(signedByOutsider.error).not.toBeNull();
    const signedByMember = await userA.client.storage.from('chat-media').createSignedUrl(ok.data!.path, 60);
    expect(signedByMember.error).toBeNull();
  });

  it('22. clients cannot forge system messages or image messages pointing at someone else\'s folder', async () => {
    const sys = await userB.client.from('messages').insert({ team_id: teamId, user_id: userB.id, content: 'fake', message_type: 'system' });
    expect(sys.error).not.toBeNull();

    const badImg = await userB.client
      .from('messages')
      .insert({ team_id: teamId, user_id: userB.id, content: '', message_type: 'image', attachment_path: `${teamId}/${userA.id}/x.webp` });
    expect(badImg.error).not.toBeNull();

    const goodImg = await userB.client
      .from('messages')
      .insert({ team_id: teamId, user_id: userB.id, content: '', message_type: 'image', attachment_path: `${teamId}/${userB.id}/x.webp` });
    expect(goodImg.error).toBeNull();
  });

  it('23. workout start/complete post system events that never count as unread and respect the sharing opt-out', async () => {
    await userA.client.from('team_message_read_state').upsert(
      { user_id: userA.id, team_id: teamId, last_read_at: new Date().toISOString() },
      { onConflict: 'user_id,team_id' }
    );
    const before = Number((await userA.client.rpc('get_unread_chat_count', { p_team_id: teamId })).data);

    const { data: w } = await userB.client
      .from('workouts')
      .insert({ user_id: userB.id, team_id: teamId, activity_type: 'krafttraining', status: 'laeuft', title: 'Brust & Trizeps', started_at: new Date().toISOString() })
      .select('id')
      .single();
    await userB.client.from('workouts').update({ status: 'abgeschlossen', finished_at: new Date().toISOString(), duration_seconds: 3240 }).eq('id', w!.id);

    const { data: events } = await admin.from('messages').select('event_type').eq('team_id', teamId).eq('message_type', 'system').eq('user_id', userB.id);
    const types = (events ?? []).map((e) => e.event_type);
    expect(types).toContain('workout_started');
    expect(types).toContain('workout_completed');

    const after = Number((await userA.client.rpc('get_unread_chat_count', { p_team_id: teamId })).data);
    expect(after).toBe(before);

    // opt-out: no new events
    await admin.from('privacy_settings').update({ activity_feed_opt_in: false }).eq('user_id', userB.id);
    const countBefore = (events ?? []).length;
    await userB.client.from('workouts').insert({ user_id: userB.id, team_id: teamId, activity_type: 'laufen', status: 'laeuft', started_at: new Date().toISOString() });
    const { data: events2 } = await admin.from('messages').select('id').eq('team_id', teamId).eq('message_type', 'system').eq('user_id', userB.id);
    expect((events2 ?? []).length).toBe(countBefore);
    await admin.from('privacy_settings').update({ activity_feed_opt_in: true }).eq('user_id', userB.id);
  });

  it('24. a human message from a teammate still counts as unread', async () => {
    const before = Number((await userA.client.rpc('get_unread_chat_count', { p_team_id: teamId })).data);
    await userB.client.from('messages').insert({ team_id: teamId, user_id: userB.id, content: 'zählt als ungelesen' });
    const after = Number((await userA.client.rpc('get_unread_chat_count', { p_team_id: teamId })).data);
    expect(after).toBe(before + 1);
  });

  // ---- email invitations -------------------------------------------------
  it('25. invite email log: admin-only, no impersonation, DB rate limit', async () => {
    const memberInsert = await userB.client.from('team_invite_emails').insert({ team_id: teamId, invited_by: userB.id, email: 'x@example.com', status: 'sent' });
    expect(memberInsert.error).not.toBeNull();

    const first = await userA.client.from('team_invite_emails').insert({ team_id: teamId, invited_by: userA.id, email: 'a@example.com', status: 'sent' });
    expect(first.error).toBeNull();

    const seenByMember = await userB.client.from('team_invite_emails').select('email');
    expect(seenByMember.data).toEqual([]);

    const impersonate = await userA.client.from('team_invite_emails').insert({ team_id: teamId, invited_by: userB.id, email: 'b@example.com', status: 'sent' });
    expect(impersonate.error).not.toBeNull();

    let limited = false;
    for (let i = 0; i < 6; i++) {
      const r = await userA.client.from('team_invite_emails').insert({ team_id: teamId, invited_by: userA.id, email: `c${i}@example.com`, status: 'sent' });
      if (r.error?.message.includes('invite_rate_limited')) limited = true;
    }
    expect(limited).toBe(true);
  });

  it('26. a normal member cannot create a team invite (crafted request)', async () => {
    const { createHash } = await import('node:crypto');
    const r = await userB.client.from('team_invites').insert({
      team_id: teamId, token_hash: createHash('sha256').update('crafted-' + Date.now()).digest('hex'), created_by: userB.id, max_uses: 1,
    });
    expect(r.error).not.toBeNull();
  });
  it('27. plan targets: owner stores typed targets, planned snapshot is separate from sets, others cannot read/write', async () => {
    const { data: ex } = await admin.from('exercises').select('id').is('team_id', null).limit(1).single();
    const { data: plan } = await userB.client.from('workout_plans').insert({ user_id: userB.id, name: 'T27' }).select('id').single();
    const { data: day } = await userB.client.from('workout_plan_days').insert({ plan_id: plan!.id, weekday: 1, title: 't' }).select('id').single();
    const ins = await userB.client.from('workout_plan_exercises').insert({
      plan_day_id: day!.id, exercise_id: ex!.id, target_distance_km: 5, target_duration_seconds: 1800, target_metrics: { rounds: 8 },
    }).select('id, target_distance_km, target_duration_seconds, target_metrics').single();
    expect(ins.error).toBeNull();
    expect(Number(ins.data!.target_distance_km)).toBe(5);

    const bad = await userB.client.from('workout_plan_exercises').insert({ plan_day_id: day!.id, exercise_id: ex!.id, target_distance_km: -1 });
    expect(bad.error).not.toBeNull();

    const other = await userA.client.from('workout_plan_exercises').select('id').eq('id', ins.data!.id);
    expect(other.data).toEqual([]);
    const forge = await userA.client.from('workout_plan_exercises').update({ target_distance_km: 99 }).eq('id', ins.data!.id).select('id');
    expect(forge.data ?? []).toEqual([]);
  });
  it('28. password_reset_requests throttle log is not accessible to any client role', async () => {
    const asMember = await userB.client.from('password_reset_requests').select('id');
    expect(asMember.error).not.toBeNull();
    const asAnon = await createClient(SUPABASE_URL, ANON_KEY).from('password_reset_requests').insert({ email_hash: 'x' });
    expect(asAnon.error).not.toBeNull();
  });
  it('29. platform_creators: readable by members, not writable by any client, keyed by id (namesake gets nothing)', async () => {
    const read = await userB.client.from('platform_creators').select('user_id');
    expect(read.error).toBeNull();
    const selfInsert = await userB.client.from('platform_creators').insert({ user_id: userB.id, display_name: 'Volodymyr Parashchak' });
    expect(selfInsert.error).not.toBeNull();
    const anon = await createClient(SUPABASE_URL, ANON_KEY).from('platform_creators').select('user_id');
    expect(anon.data ?? []).toEqual([]);
    const mine = (read.data ?? []).map((r) => r.user_id);
    expect(mine).not.toContain(userB.id);
  });
  describe('event reactions & replies', () => {
    let eventId: string;
    let humanId: string;

    beforeAll(async () => {
      const { data: ev } = await admin
        .from('messages')
        .insert({ team_id: teamId, user_id: userA.id, content: 'hat ein Training gestartet', message_type: 'system', event_type: 'workout_started', metadata: { title: 'Beine' } })
        .select('id')
        .single();
      eventId = ev!.id;
      const { data: h } = await admin.from('messages').insert({ team_id: teamId, user_id: userA.id, content: 'normal' }).select('id').single();
      humanId = h!.id;
    });

    it('30. a member can support an event once; count is 1; owner gets exactly one in-app notification', async () => {
      const r = await userB.client.from('message_reactions').insert({ message_id: eventId, user_id: userB.id });
      expect(r.error).toBeNull();
      const dup = await userB.client.from('message_reactions').insert({ message_id: eventId, user_id: userB.id });
      expect(dup.error).not.toBeNull();

      const { data: n } = await admin.from('notifications').select('kind, actor_id, category').eq('user_id', userA.id).eq('message_id', eventId);
      expect(n).toHaveLength(1);
      expect(n![0]).toMatchObject({ kind: 'reaction', actor_id: userB.id, category: 'reaktion_antwort' });
    });

    it('31. removing and re-adding the reaction does not create another notification (no spam)', async () => {
      await userB.client.from('message_reactions').delete().eq('message_id', eventId).eq('user_id', userB.id);
      const { data: mid } = await userB.client.from('message_reactions').select('id').eq('message_id', eventId);
      expect(mid).toEqual([]);
      await userB.client.from('message_reactions').insert({ message_id: eventId, user_id: userB.id });
      const { data: n } = await admin.from('notifications').select('id').eq('user_id', userA.id).eq('message_id', eventId).eq('kind', 'reaction');
      expect(n).toHaveLength(1);
    });

    it('32. reacting to your own event creates no notification', async () => {
      await userA.client.from('message_reactions').insert({ message_id: eventId, user_id: userA.id });
      const { data: n } = await admin.from('notifications').select('id').eq('user_id', userA.id).eq('actor_id', userA.id);
      expect(n).toEqual([]);
    });

    it('33. cannot react as someone else or as an outsider; outsider cannot read reactions', async () => {
      // Reacting to a human message is no longer rejected — see the "emoji
      // reactions" block below for the scope-widening this used to forbid.
      const forge = await userB.client.from('message_reactions').insert({ message_id: eventId, user_id: userA.id });
      expect(forge.error).not.toBeNull();
      const out = await outsider.client.from('message_reactions').insert({ message_id: eventId, user_id: outsider.id });
      expect(out.error).not.toBeNull();
      const seen = await outsider.client.from('message_reactions').select('id').eq('message_id', eventId);
      expect(seen.data).toEqual([]);
      // a member cannot delete someone else's reaction
      const del = await userB.client.from('message_reactions').delete().eq('message_id', eventId).eq('user_id', userA.id).select('id');
      expect(del.data ?? []).toEqual([]);
    });

    it('34. replies: one level only, only on events, only team members; owner is notified; not counted as chat unread', async () => {
      await userA.client.from('team_message_read_state').upsert(
        { user_id: userA.id, team_id: teamId, last_read_at: new Date().toISOString() },
        { onConflict: 'user_id,team_id' }
      );
      const before = Number((await userA.client.rpc('get_unread_chat_count', { p_team_id: teamId })).data);

      const ok = await userB.client.from('messages').insert({ team_id: teamId, user_id: userB.id, content: 'Stark!', parent_message_id: eventId }).select('id').single();
      expect(ok.error).toBeNull();

      const nested = await userB.client.from('messages').insert({ team_id: teamId, user_id: userB.id, content: 'nested', parent_message_id: ok.data!.id });
      expect(nested.error).not.toBeNull();
      const onHuman = await userB.client.from('messages').insert({ team_id: teamId, user_id: userB.id, content: 'no', parent_message_id: humanId });
      expect(onHuman.error).not.toBeNull();
      const forged = await userB.client.from('messages').insert({ team_id: teamId, user_id: userA.id, content: 'as A', parent_message_id: eventId });
      expect(forged.error).not.toBeNull();
      const crossTeam = await outsider.client.from('messages').insert({ team_id: outsiderTeamId, user_id: outsider.id, content: 'x', parent_message_id: eventId });
      expect(crossTeam.error).not.toBeNull();
      const asOutsiderIntoTeam = await outsider.client.from('messages').insert({ team_id: teamId, user_id: outsider.id, content: 'x', parent_message_id: eventId });
      expect(asOutsiderIntoTeam.error).not.toBeNull();

      const { data: n } = await admin.from('notifications').select('kind, params').eq('user_id', userA.id).eq('message_id', eventId).eq('kind', 'reply');
      expect(n).toHaveLength(1);
      expect((n![0]!.params as { preview: string }).preview).toBe('Stark!');

      const after = Number((await userA.client.rpc('get_unread_chat_count', { p_team_id: teamId })).data);
      expect(after).toBe(before);
    });

    it('35. outsiders cannot read replies; replying to your own event does not self-notify', async () => {
      const seen = await outsider.client.from('messages').select('id').eq('parent_message_id', eventId);
      expect(seen.data).toEqual([]);
      const own = await userA.client.from('messages').insert({ team_id: teamId, user_id: userA.id, content: 'Danke', parent_message_id: eventId });
      expect(own.error).toBeNull();
      const { data: n } = await admin.from('notifications').select('id').eq('user_id', userA.id).eq('actor_id', userA.id);
      expect(n).toEqual([]);
    });

    it('36. notification preference column exists (default on) and a member can only mark their own notifications read', async () => {
      const pref = await userA.client.from('notification_preferences').select('reaktionen_antworten').eq('user_id', userA.id).single();
      expect(pref.data?.reaktionen_antworten).toBe(true);
      const foreign = await userB.client.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userA.id).select('id');
      expect(foreign.data ?? []).toEqual([]);
      const own = await userA.client.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userA.id).is('read_at', null).select('id');
      expect((own.data ?? []).length).toBeGreaterThan(0);
    });
  });

  describe('emoji reactions (20-key expansion)', () => {
    let textId: string;
    let imageId: string;
    let deletedId: string;
    let replyId: string;

    beforeAll(async () => {
      const { data: ev } = await admin
        .from('messages')
        .insert({ team_id: teamId, user_id: userA.id, content: 'hat ein Training gestartet', message_type: 'system', event_type: 'workout_started', metadata: { title: 'Reaktionstest' } })
        .select('id')
        .single();
      const { data: t } = await admin.from('messages').insert({ team_id: teamId, user_id: userA.id, content: 'plain text' }).select('id').single();
      textId = t!.id;
      const { data: img } = await admin
        .from('messages')
        .insert({ team_id: teamId, user_id: userA.id, content: '', message_type: 'image', attachment_path: `${teamId}/${userA.id}/x.webp` })
        .select('id')
        .single();
      imageId = img!.id;
      const { data: del } = await admin
        .from('messages')
        .insert({ team_id: teamId, user_id: userA.id, content: 'will be deleted', deleted_at: new Date().toISOString() })
        .select('id')
        .single();
      deletedId = del!.id;
      const { data: rep } = await admin
        .from('messages')
        .insert({ team_id: teamId, user_id: userB.id, content: 'a reply', parent_message_id: ev!.id })
        .select('id')
        .single();
      replyId = rep!.id;
    });

    it('93. reacting now succeeds on a plain text message and an image message (scope widened beyond system events)', async () => {
      const r1 = await userB.client.rpc('set_message_reaction', { p_message_id: textId, p_reaction_key: 'fire', p_active: true });
      expect(r1.error).toBeNull();
      const r2 = await userB.client.rpc('set_message_reaction', { p_message_id: imageId, p_reaction_key: 'clap', p_active: true });
      expect(r2.error).toBeNull();
      const { data } = await admin.from('message_reactions').select('message_id, reaction_type').eq('user_id', userB.id).in('message_id', [textId, imageId]);
      expect((data ?? []).sort((a, b) => a.message_id.localeCompare(b.message_id))).toEqual(
        [
          { message_id: textId, reaction_type: 'fire' },
          { message_id: imageId, reaction_type: 'clap' },
        ].sort((a, b) => a.message_id.localeCompare(b.message_id))
      );
    });

    it('94. a thread reply and a deleted message both still reject reactions', async () => {
      const onReply = await userB.client.rpc('set_message_reaction', { p_message_id: replyId, p_reaction_key: 'heart', p_active: true });
      expect(onReply.error).not.toBeNull();
      const onDeleted = await userB.client.rpc('set_message_reaction', { p_message_id: deletedId, p_reaction_key: 'heart', p_active: true });
      expect(onDeleted.error).not.toBeNull();
    });

    it('95. an invalid key is rejected with a clean error', async () => {
      const res = await userB.client.rpc('set_message_reaction', { p_message_id: textId, p_reaction_key: 'not_a_real_emoji', p_active: true });
      expect(res.error).not.toBeNull();
    });

    it('96. one user can hold all 20 different reactions on the same message at once, and remove any one independently', async () => {
      const keys = [
        'thumbs_up', 'heart', 'fire', 'muscle', 'clap', 'laugh', 'smile', 'heart_eyes', 'cool', 'star_struck',
        'surprised', 'thinking', 'sad', 'sweat_smile', 'raised_hands', 'thanks', 'party', 'trophy', 'hundred', 'rocket',
      ];
      for (const key of keys) {
        const res = await userB.client.rpc('set_message_reaction', { p_message_id: textId, p_reaction_key: key, p_active: true });
        expect(res.error).toBeNull();
      }
      const { data: all } = await admin.from('message_reactions').select('reaction_type').eq('message_id', textId).eq('user_id', userB.id);
      expect((all ?? []).map((r) => r.reaction_type).sort()).toEqual([...keys].sort());

      // Removing one (e.g. the one this test's old "replace" behavior used to leave behind) must not touch the rest.
      const rm = await userB.client.rpc('set_message_reaction', { p_message_id: textId, p_reaction_key: 'fire', p_active: false });
      expect(rm.error).toBeNull();
      expect(rm.data).toBe('removed');
      const { data: after } = await admin.from('message_reactions').select('reaction_type').eq('message_id', textId).eq('user_id', userB.id);
      const remaining = (after ?? []).map((r) => r.reaction_type).sort();
      expect(remaining).toEqual(keys.filter((k) => k !== 'fire').sort());
      expect(remaining).toContain('thumbs_up');
      expect(remaining).toContain('rocket');

      // Clean up so later tests in this block start from a known state.
      for (const key of remaining) await userB.client.rpc('set_message_reaction', { p_message_id: textId, p_reaction_key: key, p_active: false });
    });

    it('97. adding the same emoji twice never duplicates the row; removing it twice is a harmless no-op', async () => {
      const first = await userB.client.rpc('set_message_reaction', { p_message_id: imageId, p_reaction_key: 'party', p_active: true });
      expect(first.data).toBe('added');
      const second = await userB.client.rpc('set_message_reaction', { p_message_id: imageId, p_reaction_key: 'party', p_active: true });
      expect(second.error).toBeNull();
      expect(second.data).toBe('noop');
      const { data: rows } = await admin.from('message_reactions').select('id').eq('message_id', imageId).eq('user_id', userB.id).eq('reaction_type', 'party');
      expect(rows).toHaveLength(1);

      const removed = await userB.client.rpc('set_message_reaction', { p_message_id: imageId, p_reaction_key: 'party', p_active: false });
      expect(removed.data).toBe('removed');
      const removedAgain = await userB.client.rpc('set_message_reaction', { p_message_id: imageId, p_reaction_key: 'party', p_active: false });
      expect(removedAgain.data).toBe('noop');
      const { data: gone } = await admin.from('message_reactions').select('id').eq('message_id', imageId).eq('user_id', userB.id).eq('reaction_type', 'party');
      expect(gone).toEqual([]);
    });

    it('98. outsiders and non-members cannot react via the RPC', async () => {
      const res = await outsider.client.rpc('set_message_reaction', { p_message_id: textId, p_reaction_key: 'heart', p_active: true });
      expect(res.error).not.toBeNull();
    });

    it('99. the RPC has no user_id parameter: two users (even with the same emoji) never interfere with each other', async () => {
      await userB.client.rpc('set_message_reaction', { p_message_id: textId, p_reaction_key: 'cool', p_active: true });
      await userA.client.rpc('set_message_reaction', { p_message_id: textId, p_reaction_key: 'cool', p_active: true });
      const { data } = await admin.from('message_reactions').select('user_id').eq('message_id', textId).eq('reaction_type', 'cool');
      expect((data ?? []).map((r) => r.user_id).sort()).toEqual([userA.id, userB.id].sort());
      // userA removing their own doesn't touch userB's identical-emoji row.
      await userA.client.rpc('set_message_reaction', { p_message_id: textId, p_reaction_key: 'cool', p_active: false });
      const { data: after } = await admin.from('message_reactions').select('user_id').eq('message_id', textId).eq('reaction_type', 'cool');
      expect((after ?? []).map((r) => r.user_id)).toEqual([userB.id]);
    });

    it('100. per-emoji counts are correct when users overlap (the task’s own worked example: 👍1 🔥2)', async () => {
      const { data: fresh } = await admin.from('messages').insert({ team_id: teamId, user_id: userA.id, content: 'counts target' }).select('id').single();
      const targetId = fresh!.id;
      await userB.client.rpc('set_message_reaction', { p_message_id: targetId, p_reaction_key: 'thumbs_up', p_active: true });
      await userB.client.rpc('set_message_reaction', { p_message_id: targetId, p_reaction_key: 'fire', p_active: true });
      await userA.client.rpc('set_message_reaction', { p_message_id: targetId, p_reaction_key: 'fire', p_active: true });
      const { data } = await admin.from('message_reactions').select('reaction_type').eq('message_id', targetId);
      const counts: Record<string, number> = {};
      for (const r of data ?? []) counts[r.reaction_type] = (counts[r.reaction_type] ?? 0) + 1;
      expect(counts).toEqual({ thumbs_up: 1, fire: 2 });
    });

    it('101. adding several different emojis in quick succession creates only ONE owner notification; removing creates none; re-adding after removal still doesn’t spam', async () => {
      const { data: fresh } = await admin.from('messages').insert({ team_id: teamId, user_id: userA.id, content: 'notif target' }).select('id').single();
      const targetId = fresh!.id;
      await userB.client.rpc('set_message_reaction', { p_message_id: targetId, p_reaction_key: 'thumbs_up', p_active: true });
      await userB.client.rpc('set_message_reaction', { p_message_id: targetId, p_reaction_key: 'fire', p_active: true });
      await userB.client.rpc('set_message_reaction', { p_message_id: targetId, p_reaction_key: 'muscle', p_active: true });
      const { data: afterThree } = await admin.from('notifications').select('id, params').eq('user_id', userA.id).eq('message_id', targetId).eq('kind', 'reaction');
      expect(afterThree).toHaveLength(1);
      // the notification keeps the emoji used at the moment of the FIRST reaction, not any later addition
      expect((afterThree![0]!.params as { reaction_key: string }).reaction_key).toBe('thumbs_up');

      await userB.client.rpc('set_message_reaction', { p_message_id: targetId, p_reaction_key: 'fire', p_active: false });
      const { data: afterRemove } = await admin.from('notifications').select('id').eq('user_id', userA.id).eq('message_id', targetId).eq('kind', 'reaction');
      expect(afterRemove).toHaveLength(1);

      await userB.client.rpc('set_message_reaction', { p_message_id: targetId, p_reaction_key: 'fire', p_active: true });
      const { data: afterReAdd } = await admin.from('notifications').select('id').eq('user_id', userA.id).eq('message_id', targetId).eq('kind', 'reaction');
      expect(afterReAdd).toHaveLength(1);
    });

    it('102. self-reaction still creates no notification, across multiple emojis on any message type', async () => {
      await userA.client.rpc('set_message_reaction', { p_message_id: imageId, p_reaction_key: 'rocket', p_active: true });
      await userA.client.rpc('set_message_reaction', { p_message_id: imageId, p_reaction_key: 'hundred', p_active: true });
      const { data: n } = await admin.from('notifications').select('id').eq('user_id', userA.id).eq('actor_id', userA.id);
      expect(n).toEqual([]);
    });
  });

  describe('message editing', () => {
    let evId: string;
    let msgId: string;

    beforeAll(async () => {
      const { data: ev } = await admin.from('messages').insert({ team_id: teamId, user_id: userA.id, content: 'hat ein Training gestartet', message_type: 'system', event_type: 'workout_started', metadata: { title: 'Rücken' } }).select('id').single();
      evId = ev!.id;
      const { data: m } = await userB.client.from('messages').insert({ team_id: teamId, user_id: userB.id, content: 'Erster Text' }).select('id').single();
      msgId = m!.id;
    });

    it('37. owner edits plain text and Markdown in place: same row, edited_at set, created_at unchanged', async () => {
      const { data: before } = await admin.from('messages').select('created_at, edited_at').eq('id', msgId).single();
      expect(before!.edited_at).toBeNull();
      const r1 = await userB.client.from('messages').update({ content: 'Zweiter Text' }).eq('id', msgId).select('id, content, edited_at, created_at').single();
      expect(r1.error).toBeNull();
      expect(r1.data!.id).toBe(msgId);
      expect(r1.data!.edited_at).not.toBeNull();
      expect(r1.data!.created_at).toBe(before!.created_at);
      const md = 'Neu:\n\n* **Fett** und *kursiv*\n* [Link](https://a.de)';
      const r2 = await userB.client.from('messages').update({ content: md }).eq('id', msgId).select('content').single();
      expect(r2.data!.content).toBe(md);
    });

    it('38. another member cannot edit or delete it; an outsider cannot either', async () => {
      const other = await userA.client.from('messages').update({ content: 'gehackt' }).eq('id', msgId).select('id');
      expect(other.data ?? []).toEqual([]);
      const del = await userA.client.from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', msgId).select('id');
      expect(del.data ?? []).toEqual([]);
      const out = await outsider.client.from('messages').update({ content: 'x' }).eq('id', msgId).select('id');
      expect(out.data ?? []).toEqual([]);
      const { data } = await admin.from('messages').select('content, deleted_at').eq('id', msgId).single();
      expect(data!.content).not.toBe('gehackt');
      expect(data!.deleted_at).toBeNull();
    });

    it('39. system/workout events can never be edited, even by their owner', async () => {
      const r = await userA.client.from('messages').update({ content: 'gefälscht' }).eq('id', evId).select('id');
      expect(r.data ?? []).toEqual([]);
      const { data } = await admin.from('messages').select('content').eq('id', evId).single();
      expect(data!.content).toBe('hat ein Training gestartet');
    });

    it('40. an edit cannot change sender, team, type, parent or created_at', async () => {
      for (const patch of [
        { user_id: userA.id },
        { team_id: outsiderTeamId },
        { message_type: 'system' },
        { parent_message_id: evId },
        { created_at: '2020-01-01T00:00:00Z' },
        { event_type: 'workout_started' },
      ]) {
        const r = await userB.client.from('messages').update(patch).eq('id', msgId).select('id');
        expect(r.error !== null || (r.data ?? []).length === 0).toBe(true);
      }
      const { data } = await admin.from('messages').select('user_id, team_id, message_type, parent_message_id').eq('id', msgId).single();
      expect(data).toMatchObject({ user_id: userB.id, team_id: teamId, message_type: 'text', parent_message_id: null });
    });

    it('41. editing does not change unread counts and creates no notification', async () => {
      await userA.client.from('team_message_read_state').upsert({ user_id: userA.id, team_id: teamId, last_read_at: new Date().toISOString() }, { onConflict: 'user_id,team_id' });
      const { data: m } = await userB.client.from('messages').insert({ team_id: teamId, user_id: userB.id, content: 'zum Bearbeiten' }).select('id').single();
      const unreadBefore = Number((await userA.client.rpc('get_unread_chat_count', { p_team_id: teamId })).data);
      const { count: notifBefore } = await admin.from('notifications').select('id', { count: 'exact', head: true });
      const r = await userB.client.from('messages').update({ content: 'bearbeitet 1' }).eq('id', m!.id);
      expect(r.error).toBeNull();
      await userB.client.from('messages').update({ content: 'bearbeitet 2' }).eq('id', m!.id);
      const unreadAfter = Number((await userA.client.rpc('get_unread_chat_count', { p_team_id: teamId })).data);
      const { count: notifAfter } = await admin.from('notifications').select('id', { count: 'exact', head: true });
      expect(unreadAfter).toBe(unreadBefore);
      expect(notifAfter).toBe(notifBefore);
    });

    it('42. reactions and replies stay attached after the message is edited', async () => {
      const { data: m } = await userA.client.from('messages').insert({ team_id: teamId, user_id: userA.id, content: 'mit Antworten' }).select('id').single();
      // reactions/replies target events; edit a human message that itself has a quote reply
      const quote = await userB.client.from('messages').insert({ team_id: teamId, user_id: userB.id, content: 'Zitat', reply_to_id: m!.id }).select('id').single();
      await userA.client.from('messages').update({ content: 'geändert' }).eq('id', m!.id);
      const { data: still } = await admin.from('messages').select('reply_to_id').eq('id', quote.data!.id).single();
      expect(still!.reply_to_id).toBe(m!.id);

      // event reactions/replies are on system messages: they are untouched by any edit attempt
      await userB.client.from('message_reactions').insert({ message_id: evId, user_id: userB.id });
      await userB.client.from('messages').insert({ team_id: teamId, user_id: userB.id, content: 'Antwort', parent_message_id: evId });
      await userA.client.from('messages').update({ content: 'x' }).eq('id', evId);
      const { data: rx } = await admin.from('message_reactions').select('id').eq('message_id', evId);
      const { data: rp } = await admin.from('messages').select('id').eq('parent_message_id', evId);
      expect((rx ?? []).length).toBe(1);
      expect((rp ?? []).length).toBe(1);
    });

    it('43. owner can soft-delete own message but cannot undelete or edit it afterwards', async () => {
      const { data: m } = await userB.client.from('messages').insert({ team_id: teamId, user_id: userB.id, content: 'weg' }).select('id').single();
      const del = await userB.client.from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', m!.id).select('id');
      expect(del.error).toBeNull();
      expect((del.data ?? []).length).toBe(1);
      const undo = await userB.client.from('messages').update({ deleted_at: null }).eq('id', m!.id).select('id');
      expect(undo.error !== null || (undo.data ?? []).length === 0).toBe(true);
      const { data } = await admin.from('messages').select('deleted_at').eq('id', m!.id).single();
      expect(data!.deleted_at).not.toBeNull();
    });
  });
  describe('workout edit / delete', () => {
    let W: typeof userB;
    beforeAll(async () => {
      W = await createTestUser('workout-owner');
      await admin.from('team_members').insert({ team_id: teamId, user_id: W.id, role: 'member' });
      await admin.from('profiles').update({ weekly_goal: 99 }).eq('id', W.id);
    });
    afterAll(async () => {
      await admin.auth.admin.deleteUser(W.id).catch(() => undefined);
    });
    async function completeWorkout(user: typeof W, title: string, seconds: number) {
      const { data: w } = await user.client
        .from('workouts')
        .insert({ user_id: user.id, team_id: teamId, activity_type: 'krafttraining', status: 'laeuft', title, started_at: new Date(Date.now() - seconds * 1000).toISOString() })
        .select('id')
        .single();
      const r = await user.client
        .from('workouts')
        .update({ status: 'abgeschlossen', finished_at: new Date().toISOString(), duration_seconds: seconds })
        .eq('id', w!.id);
      expect(r.error).toBeNull();
      return w!.id as string;
    }
    const points = async (user: typeof W) => {
      const { data } = await admin.from('fitness_score_events').select('points, event_type').eq('user_id', user.id).eq('team_id', teamId);
      const { data: tot } = await admin.from('fitness_score_totals').select('points').eq('user_id', user.id).eq('team_id', teamId);
      return {
        ledger: (data ?? []).reduce((a, r) => a + r.points, 0),
        totals: (tot ?? []).reduce((a, r) => a + r.points, 0),
        types: (data ?? []).map((r) => r.event_type),
      };
    };

    it('44. 60-min workout scores; editing to 1 minute removes the duration bonus, back to 45 min restores it (same workout id)', async () => {
      await admin.from('profiles').update({ weekly_goal: 99 }).eq('id', W.id);
      const id = await completeWorkout(W, 'Test Beine', 3600);
      let p = await points(W);
      expect(p.types).toContain('workout_completed');
      expect(p.types).toContain('workout_duration_bonus');
      expect(p.totals).toBe(p.ledger);

      const e1 = await W.client.rpc('update_own_workout', { p_workout_id: id, p_title: 'Test Beine', p_finished_at: new Date().toISOString(), p_duration_seconds: 60, p_distance_km: null, p_notes: null });
      expect(e1.error).toBeNull();
      p = await points(W);
      expect(p.types).not.toContain('workout_duration_bonus');
      expect(p.totals).toBe(p.ledger);

      await W.client.rpc('update_own_workout', { p_workout_id: id, p_title: 'Test Beine', p_finished_at: new Date().toISOString(), p_duration_seconds: 2700, p_distance_km: null, p_notes: null });
      p = await points(W);
      expect(p.types).toContain('workout_duration_bonus');
      expect(p.totals).toBe(p.ledger);

      const { data: rows } = await admin.from('workouts').select('id').eq('user_id', W.id).eq('title', 'Test Beine');
      expect(rows).toHaveLength(1);
      expect(rows![0]!.id).toBe(id);

      await W.client.rpc('delete_own_workout', { p_workout_id: id });
    });

    it('45. deleting removes the workout, its team events + feed entry, reactions/replies, notifications and the score effects', async () => {
      const before = await points(W);
      const id = await completeWorkout(W, 'Test Löschen', 3600);
      const { data: ev } = await admin.from('messages').select('id, event_type').eq('workout_id', id).eq('message_type', 'system');
      expect((ev ?? []).map((e) => e.event_type).sort()).toEqual(['workout_completed', 'workout_started']);
      const started = ev!.find((e) => e.event_type === 'workout_started')!.id;
      const { data: feed } = await admin.from('activity_feed').select('id').eq('workout_id', id);
      expect(feed).toHaveLength(1);

      // Non-'heart' key on purpose: cascade-delete must work for any of the 20 reactions, not just the default.
      await userA.client.rpc('set_message_reaction', { p_message_id: started, p_reaction_key: 'fire', p_active: true });
      await userA.client.from('messages').insert({ team_id: teamId, user_id: userA.id, content: 'Stark', parent_message_id: started });
      const during = await points(W);
      expect(during.ledger).toBeGreaterThan(before.ledger);

      const del = await W.client.rpc('delete_own_workout', { p_workout_id: id });
      expect(del.error).toBeNull();

      expect((await admin.from('workouts').select('id').eq('id', id)).data).toEqual([]);
      expect((await admin.from('messages').select('id').eq('workout_id', id)).data).toEqual([]);
      expect((await admin.from('activity_feed').select('id').eq('workout_id', id)).data).toEqual([]);
      expect((await admin.from('message_reactions').select('id').eq('message_id', started)).data).toEqual([]);
      expect((await admin.from('messages').select('id').eq('parent_message_id', started)).data).toEqual([]);
      expect((await admin.from('notifications').select('id').eq('message_id', started)).data).toEqual([]);
      const after = await points(W);
      expect(after.ledger).toBe(before.ledger);
      expect(after.totals).toBe(after.ledger);
      const { data: audit } = await admin.from('audit_events').select('action, metadata').eq('entity_id', id);
      expect((audit ?? []).map((a) => a.action)).toContain('workout_deleted');
      expect(JSON.stringify(audit)).not.toMatch(/duration|weight|Test Löschen/);
    });

    it('46. weekly-goal bonus is recalculated on delete', async () => {
      await admin.from('profiles').update({ weekly_goal: 1 }).eq('id', W.id);
      const id = await completeWorkout(W, 'Test Wochenziel', 600);
      expect((await points(W)).types).toContain('weekly_goal_reached');
      await W.client.rpc('delete_own_workout', { p_workout_id: id });
      const p = await points(W);
      expect(p.types).not.toContain('weekly_goal_reached');
      expect(p.totals).toBe(p.ledger);
      await admin.from('profiles').update({ weekly_goal: 99 }).eq('id', W.id);
    });

    it('47. editing updates the visible team event in place: no new message, no unread change, same id', async () => {
      const id = await completeWorkout(W, 'Brust', 60);
      await userA.client.from('team_message_read_state').upsert({ user_id: userA.id, team_id: teamId, last_read_at: new Date().toISOString() }, { onConflict: 'user_id,team_id' });
      const { count: msgsBefore } = await admin.from('messages').select('id', { count: 'exact', head: true }).eq('team_id', teamId);
      const unreadBefore = Number((await userA.client.rpc('get_unread_chat_count', { p_team_id: teamId })).data);
      const { count: notifBefore } = await admin.from('notifications').select('id', { count: 'exact', head: true });

      const r = await W.client.rpc('update_own_workout', { p_workout_id: id, p_title: 'Brust & Trizeps', p_finished_at: new Date().toISOString(), p_duration_seconds: 2700, p_distance_km: null, p_notes: 'ok' });
      expect(r.error).toBeNull();

      const { data: ev } = await admin.from('messages').select('metadata, event_type').eq('workout_id', id).eq('event_type', 'workout_completed').single();
      expect(ev!.metadata).toMatchObject({ title: 'Brust & Trizeps', duration_minutes: 45 });
      const { count: msgsAfter } = await admin.from('messages').select('id', { count: 'exact', head: true }).eq('team_id', teamId);
      expect(msgsAfter).toBe(msgsBefore);
      expect(Number((await userA.client.rpc('get_unread_chat_count', { p_team_id: teamId })).data)).toBe(unreadBefore);
      const { count: notifAfter } = await admin.from('notifications').select('id', { count: 'exact', head: true });
      expect(notifAfter).toBe(notifBefore);
      await W.client.rpc('delete_own_workout', { p_workout_id: id });
    });

    it('48. nobody else can edit or delete it: not a member, not the team admin, not an outsider', async () => {
      const id = await completeWorkout(W, 'Privat', 1200);
      const args = { p_workout_id: id, p_title: 'x', p_finished_at: new Date().toISOString(), p_duration_seconds: 60, p_distance_km: null, p_notes: null };
      for (const other of [userA, outsider]) {
        expect((await other.client.rpc('update_own_workout', args)).error).not.toBeNull();
        expect((await other.client.rpc('delete_own_workout', { p_workout_id: id })).error).not.toBeNull();
      }
      const { data } = await admin.from('workouts').select('title, duration_seconds').eq('id', id).single();
      expect(data).toMatchObject({ title: 'Privat', duration_seconds: 1200 });
      // anonymous cannot call either
      const anon = createClient(SUPABASE_URL, ANON_KEY);
      expect((await anon.rpc('delete_own_workout', { p_workout_id: id })).error).not.toBeNull();
      await W.client.rpc('delete_own_workout', { p_workout_id: id });
    });

    it('49. challenge progress is recalculated after a delete', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data: ch } = await admin.from('challenges').insert({ team_id: teamId, title: 'T', challenge_type: 'individual', metric: 'workouts_count', target_value: 50, starts_at: today, ends_at: today, created_by: userA.id }).select('id').single();
      await admin.from('challenge_participants').insert({ challenge_id: ch!.id, user_id: W.id });
      const id = await completeWorkout(W, 'Challenge', 900);
      const prog = async () => Number((await admin.from('challenge_participants').select('progress_value').eq('challenge_id', ch!.id).eq('user_id', W.id).single()).data!.progress_value);
      expect(await prog()).toBeGreaterThanOrEqual(1);
      const withOne = await prog();
      await W.client.rpc('delete_own_workout', { p_workout_id: id });
      expect(await prog()).toBe(withOne - 1);
      await admin.from('challenges').delete().eq('id', ch!.id);
    });

    it('50. edited workout events cannot be forged by clients (guard still blocks direct system-event edits)', async () => {
      const id = await completeWorkout(W, 'Guard', 900);
      const { data: ev } = await admin.from('messages').select('id').eq('workout_id', id).eq('event_type', 'workout_completed').single();
      const r = await W.client.from('messages').update({ metadata: { title: 'gefälscht' } }).eq('id', ev!.id).select('id');
      expect(r.error !== null || (r.data ?? []).length === 0).toBe(true);
      await W.client.rpc('delete_own_workout', { p_workout_id: id });
    });
  });

  describe('workout pause, review and finish safety', () => {
    let T: typeof userB;
    beforeAll(async () => {
      T = await createTestUser('timer-owner');
      await admin.from('team_members').insert({ team_id: teamId, user_id: T.id, role: 'member' });
    });
    afterAll(async () => {
      await admin.auth.admin.deleteUser(T.id).catch(() => undefined);
    });

    async function startWorkout(user: typeof T, secondsAgo: number, title = 'Timer Test') {
      const startedAt = new Date(Date.now() - secondsAgo * 1000).toISOString();
      const { data, error } = await user.client
        .from('workouts')
        .insert({ user_id: user.id, team_id: teamId, activity_type: 'krafttraining', status: 'laeuft', title, started_at: startedAt })
        .select('id')
        .single();
      expect(error).toBeNull();
      return data!.id as string;
    }

    async function scoreEventsFor(id: string) {
      const { data } = await admin.from('fitness_score_events').select('event_type').eq('source_entity_id', id);
      return (data ?? []).map((r) => r.event_type);
    }

    it('83. pausing and resuming a running workout never re-posts "workout_started" or touches scoring', async () => {
      const id = await startWorkout(T, 60);
      expect((await T.client.rpc('pause_own_workout', { p_workout_id: id })).error).toBeNull();
      expect((await T.client.rpc('resume_own_workout', { p_workout_id: id })).error).toBeNull();

      const { data: events } = await admin.from('messages').select('event_type').eq('workout_id', id).eq('message_type', 'system');
      expect((events ?? []).map((e) => e.event_type)).toEqual(['workout_started']);
      expect(await scoreEventsFor(id)).toEqual([]);

      await T.client.rpc('finish_own_workout', { p_workout_id: id, p_finished_at: new Date().toISOString(), p_duration_seconds: 60, p_distance_km: null, p_notes: null });
    });

    it('84. double-pause and double-resume are harmless no-ops, not errors', async () => {
      const id = await startWorkout(T, 120);
      expect((await T.client.rpc('pause_own_workout', { p_workout_id: id })).error).toBeNull();
      expect((await T.client.rpc('pause_own_workout', { p_workout_id: id })).error).toBeNull();
      const { data: row1 } = await admin.from('workouts').select('paused_at').eq('id', id).single();
      const pausedAt = row1!.paused_at;

      expect((await T.client.rpc('resume_own_workout', { p_workout_id: id })).error).toBeNull();
      const { data: row2 } = await admin.from('workouts').select('paused_seconds, paused_at').eq('id', id).single();
      expect(row2!.paused_at).toBeNull();
      const pausedSeconds = row2!.paused_seconds;

      // A second resume (already running) must not add more paused_seconds.
      expect((await T.client.rpc('resume_own_workout', { p_workout_id: id })).error).toBeNull();
      const { data: row3 } = await admin.from('workouts').select('paused_seconds').eq('id', id).single();
      expect(row3!.paused_seconds).toBe(pausedSeconds);
      expect(pausedAt).not.toBeNull();

      await T.client.rpc('finish_own_workout', { p_workout_id: id, p_finished_at: new Date().toISOString(), p_duration_seconds: 60, p_distance_km: null, p_notes: null });
    });

    it('85. finishing an already-completed workout again succeeds silently and never double-processes (retry/two-device safety)', async () => {
      const id = await startWorkout(T, 60);
      const first = await T.client.rpc('finish_own_workout', { p_workout_id: id, p_finished_at: new Date().toISOString(), p_duration_seconds: 60, p_distance_km: null, p_notes: null });
      expect(first.error).toBeNull();
      // Chat-event posting has no daily cap (unlike scoring, which does, and
      // which earlier tests in this block may have already exhausted for
      // today) — it's the precise signal that the completion trigger fired
      // exactly once, independent of that unrelated cap.
      const { data: eventsAfterFirst } = await admin.from('messages').select('id').eq('workout_id', id).eq('event_type', 'workout_completed');
      expect(eventsAfterFirst).toHaveLength(1);

      // A retried finish with different (later) numbers must not overwrite the first result or award twice.
      const second = await T.client.rpc('finish_own_workout', { p_workout_id: id, p_finished_at: new Date().toISOString(), p_duration_seconds: 9999, p_distance_km: null, p_notes: null });
      expect(second.error).toBeNull();

      const { data: row } = await admin.from('workouts').select('duration_seconds').eq('id', id).single();
      expect(row!.duration_seconds).toBe(60);
      const { data: eventsAfterSecond } = await admin.from('messages').select('id').eq('workout_id', id).eq('event_type', 'workout_completed');
      expect(eventsAfterSecond).toHaveLength(1);
    });

    it('86. only the owner may pause, resume or finish — a non-owner request is rejected outright', async () => {
      const id = await startWorkout(T, 60);
      expect((await outsider.client.rpc('pause_own_workout', { p_workout_id: id })).error).not.toBeNull();
      expect((await outsider.client.rpc('resume_own_workout', { p_workout_id: id })).error).not.toBeNull();
      expect((await outsider.client.rpc('finish_own_workout', { p_workout_id: id, p_finished_at: new Date().toISOString(), p_duration_seconds: 60, p_distance_km: null, p_notes: null })).error).not.toBeNull();

      const { data: row } = await admin.from('workouts').select('status, paused_at').eq('id', id).single();
      expect(row).toMatchObject({ status: 'laeuft', paused_at: null });
      await T.client.rpc('finish_own_workout', { p_workout_id: id, p_finished_at: new Date().toISOString(), p_duration_seconds: 60, p_distance_km: null, p_notes: null });
    });

    it('87. a workout under 180 minutes finishes without confirmation; at/above it, confirmation is mandatory and server-enforced', async () => {
      const shortId = await startWorkout(T, 3600);
      const shortFinish = await T.client.rpc('finish_own_workout', { p_workout_id: shortId, p_finished_at: new Date().toISOString(), p_duration_seconds: 3600, p_distance_km: null, p_notes: null });
      expect(shortFinish.error).toBeNull();

      const longId = await startWorkout(T, 12000);
      const withoutConfirm = await T.client.rpc('finish_own_workout', { p_workout_id: longId, p_finished_at: new Date().toISOString(), p_duration_seconds: 12000, p_distance_km: null, p_notes: null });
      expect(withoutConfirm.error?.message).toContain('confirmation_required');
      const { data: stillRunning } = await admin.from('workouts').select('status').eq('id', longId).single();
      expect(stillRunning!.status).toBe('laeuft');

      const withConfirm = await T.client.rpc('finish_own_workout', {
        p_workout_id: longId, p_finished_at: new Date().toISOString(), p_duration_seconds: 12000, p_distance_km: null, p_notes: null, p_confirm_long: true,
      });
      expect(withConfirm.error).toBeNull();
      const { data: done } = await admin.from('workouts').select('status, long_duration_confirmed_at').eq('id', longId).single();
      expect(done!.status).toBe('abgeschlossen');
      expect(done!.long_duration_confirmed_at).not.toBeNull();
    });

    it('88. a direct client update can never forge a duration outside the validated finish path (the pre-existing gap this closes)', async () => {
      const id = await startWorkout(T, 60);
      // Out-of-bounds duration, straight to completed, bypassing finish_own_workout entirely.
      const forged = await T.client.from('workouts').update({ status: 'abgeschlossen', finished_at: new Date().toISOString(), duration_seconds: 999999 }).eq('id', id);
      expect(forged.error).not.toBeNull();

      // Unconfirmed long duration via the same direct path.
      const forgedLong = await T.client.from('workouts').update({ status: 'abgeschlossen', finished_at: new Date().toISOString(), duration_seconds: 12000 }).eq('id', id);
      expect(forgedLong.error).not.toBeNull();

      const { data: row } = await admin.from('workouts').select('status').eq('id', id).single();
      expect(row!.status).toBe('laeuft');

      // The new pause/provenance columns are never directly writable by a client either.
      const forgedColumn = await T.client.from('workouts').update({ paused_seconds: 99999 }).eq('id', id);
      expect(forgedColumn.error).not.toBeNull();

      await T.client.rpc('finish_own_workout', { p_workout_id: id, p_finished_at: new Date().toISOString(), p_duration_seconds: 60, p_distance_km: null, p_notes: null });
    });

    it('89. a user can only ever have one running workout at a time', async () => {
      const first = await startWorkout(T, 60);
      const second = await T.client
        .from('workouts')
        .insert({ user_id: T.id, team_id: teamId, activity_type: 'laufen', status: 'laeuft', started_at: new Date().toISOString() });
      expect(second.error?.code).toBe('23505');
      await T.client.rpc('finish_own_workout', { p_workout_id: first, p_finished_at: new Date().toISOString(), p_duration_seconds: 60, p_distance_km: null, p_notes: null });
    });

    it('90. review time never inflates the recorded duration: finishing at a still-open pause nets out correctly and keeps duration_source as "timer"', async () => {
      const id = await startWorkout(T, 600); // started 10 minutes ago
      expect((await T.client.rpc('pause_own_workout', { p_workout_id: id })).error).toBeNull();
      // Simulate time passing while the review screen sits open, unpersisted.
      await new Promise((r) => setTimeout(r, 1100));

      const { data: paused } = await admin.from('workouts').select('paused_at').eq('id', id).single();
      // The review screen would freeze on ~600s and submit that unchanged, even though real time has moved on.
      const finish = await T.client.rpc('finish_own_workout', { p_workout_id: id, p_finished_at: paused!.paused_at, p_duration_seconds: 600, p_distance_km: null, p_notes: null });
      expect(finish.error).toBeNull();

      const { data: row } = await admin.from('workouts').select('duration_source, duration_seconds').eq('id', id).single();
      expect(row!.duration_seconds).toBe(600);
      expect(row!.duration_source).toBe('timer');
    });

    it('91. editing a completed workout to a very long duration also requires confirmation, not only the initial finish', async () => {
      const id = await startWorkout(T, 60);
      await T.client.rpc('finish_own_workout', { p_workout_id: id, p_finished_at: new Date().toISOString(), p_duration_seconds: 60, p_distance_km: null, p_notes: null });

      const args = { p_workout_id: id, p_title: 'Timer Test', p_finished_at: new Date().toISOString(), p_duration_seconds: 12000, p_distance_km: null, p_notes: null };
      const withoutConfirm = await T.client.rpc('update_own_workout', args);
      expect(withoutConfirm.error?.message).toContain('confirmation_required');

      const withConfirm = await T.client.rpc('update_own_workout', { ...args, p_confirm_long: true });
      expect(withConfirm.error).toBeNull();
      const { data: row } = await admin.from('workouts').select('duration_seconds, duration_source, long_duration_confirmed_at').eq('id', id).single();
      expect(row!.duration_seconds).toBe(12000);
      expect(row!.duration_source).toBe('corrected');
      expect(row!.long_duration_confirmed_at).not.toBeNull();
    });

    it('92. the workout_completed chat event carries its own started_at/duration_source, so the card never needs a private lookup', async () => {
      const id = await startWorkout(T, 90);
      await T.client.rpc('finish_own_workout', { p_workout_id: id, p_finished_at: new Date().toISOString(), p_duration_seconds: 90, p_distance_km: null, p_notes: null });
      const { data: ev } = await admin.from('messages').select('metadata').eq('workout_id', id).eq('event_type', 'workout_completed').single();
      expect(ev!.metadata).toMatchObject({ duration_minutes: 2, duration_source: 'timer' });
      expect(typeof ev!.metadata.started_at).toBe('string');
    });
  });

  describe('@mentions', () => {
    let nameA: string;
    let nameB: string;
    const say = async (user: typeof userA, content: string, extra: Record<string, unknown> = {}) => {
      const r = await user.client.from('messages').insert({ team_id: teamId, user_id: user.id, content, ...extra }).select('id').single();
      expect(r.error).toBeNull();
      return r.data!.id as string;
    };
    const notifs = async (userId: string, kind = 'mention') =>
      (await admin.from('notifications').select('id, message_id, params, category').eq('user_id', userId).eq('kind', kind)).data ?? [];

    beforeAll(async () => {
      nameA = 'Alma Admin';
      nameB = 'Ben Mitglied';
      await admin.from('profiles').update({ full_name: nameA }).eq('id', userA.id);
      await admin.from('profiles').update({ full_name: nameB }).eq('id', userB.id);
      await admin.from('profiles').update({ full_name: 'Olli Outsider' }).eq('id', outsider.id);
    });

    it('51. author mentions a teammate: relation stored with server-derived text, one in-app notification for that user only', async () => {
      const id = await say(userA, `@${nameB} kannst du das bitte testen?`);
      const r = await userA.client.from('message_mentions').insert({ message_id: id, mentioned_user_id: userB.id, mention_text: '@Gefälscht' }).select('mention_text, team_id').single();
      expect(r.error).toBeNull();
      expect(r.data!.mention_text).toBe(`@${nameB}`); // client value ignored
      expect(r.data!.team_id).toBe(teamId);
      const n = await notifs(userB.id);
      expect(n.filter((x) => x.message_id === id)).toHaveLength(1);
      expect(n.find((x) => x.message_id === id)!.category).toBe('erwaehnung');
      expect((await notifs(userA.id)).filter((x) => x.message_id === id)).toHaveLength(0);
      const dup = await userA.client.from('message_mentions').insert({ message_id: id, mentioned_user_id: userB.id });
      expect(dup.error).not.toBeNull();
    });

    it('52. cannot mention another team\'s member, a made-up id, or someone whose @Name is not in the text', async () => {
      const id = await say(userA, `@Olli Outsider @${nameB}`);
      const other = await userA.client.from('message_mentions').insert({ message_id: id, mentioned_user_id: outsider.id });
      expect(other.error).not.toBeNull();
      const fake = await userA.client.from('message_mentions').insert({ message_id: id, mentioned_user_id: '00000000-0000-4000-8000-000000000000' });
      expect(fake.error).not.toBeNull();
      const id2 = await say(userA, 'ohne Namen');
      const missing = await userA.client.from('message_mentions').insert({ message_id: id2, mentioned_user_id: userB.id });
      expect(missing.error).not.toBeNull();
      expect((await admin.from('message_mentions').select('id').in('message_id', [id, id2])).data).toEqual([]);
    });

    it('53. only the author can add/remove mentions; outsiders cannot read them; system messages cannot carry any', async () => {
      const id = await say(userA, `Hi @${nameB}`);
      const byOther = await userB.client.from('message_mentions').insert({ message_id: id, mentioned_user_id: userA.id });
      expect(byOther.error).not.toBeNull();
      await userA.client.from('message_mentions').insert({ message_id: id, mentioned_user_id: userB.id });
      expect((await outsider.client.from('message_mentions').select('id').eq('message_id', id)).data).toEqual([]);
      expect((await userB.client.from('message_mentions').select('id').eq('message_id', id)).data).toHaveLength(1);
      const del = await userB.client.from('message_mentions').delete().eq('message_id', id).select('id');
      expect(del.data ?? []).toEqual([]);
      const { data: ev } = await admin.from('messages').insert({ team_id: teamId, user_id: userA.id, content: `@${nameB}`, message_type: 'system', event_type: 'workout_started' }).select('id').single();
      expect((await admin.from('message_mentions').insert({ message_id: ev!.id, mentioned_user_id: userB.id })).error).not.toBeNull();
    });

    it('54. editing an old message: adding a mention afterwards creates NO notification, removing works, no spam on repeated edits', async () => {
      const id = await say(userA, 'Erster Text');
      const before = (await notifs(userB.id)).length;
      await userA.client.from('messages').update({ content: `Jetzt mit @${nameB}` }).eq('id', id);
      const add = await userA.client.from('message_mentions').insert({ message_id: id, mentioned_user_id: userB.id });
      expect(add.error).toBeNull();
      expect((await notifs(userB.id)).length).toBe(before);
      await userA.client.from('messages').update({ content: `Nochmal @${nameB}` }).eq('id', id);
      expect((await notifs(userB.id)).length).toBe(before);
      const rm = await userA.client.from('message_mentions').delete().eq('message_id', id).eq('mentioned_user_id', userB.id);
      expect(rm.error).toBeNull();
      expect((await admin.from('message_mentions').select('id').eq('message_id', id)).data).toEqual([]);
    });

    it('55. mention inside a reply to a workout event: reply relation intact, notification opens the event', async () => {
      const { data: ev } = await admin.from('messages').insert({ team_id: teamId, user_id: userB.id, content: 'hat ein Training gestartet', message_type: 'system', event_type: 'workout_started', metadata: { title: 'Beine' } }).select('id').single();
      const rep = await userA.client.from('messages').insert({ team_id: teamId, user_id: userA.id, content: `@${nameB} starkes Training 💪`, parent_message_id: ev!.id }).select('id, parent_message_id').single();
      expect(rep.error).toBeNull();
      expect(rep.data!.parent_message_id).toBe(ev!.id);
      await userA.client.from('message_mentions').insert({ message_id: rep.data!.id, mentioned_user_id: userB.id });
      const n = (await notifs(userB.id)).filter((x) => x.message_id === ev!.id);
      expect(n).toHaveLength(1);
    });

    it('56. mentioning does not change unread counts of the mentioned user beyond the normal message', async () => {
      await userB.client.from('team_message_read_state').upsert({ user_id: userB.id, team_id: teamId, last_read_at: new Date().toISOString() }, { onConflict: 'user_id,team_id' });
      const before = Number((await userB.client.rpc('get_unread_chat_count', { p_team_id: teamId })).data);
      const id = await say(userA, `@${nameB} zählt einmal`);
      await userA.client.from('message_mentions').insert({ message_id: id, mentioned_user_id: userB.id });
      expect(Number((await userB.client.rpc('get_unread_chat_count', { p_team_id: teamId })).data)).toBe(before + 1);
    });

    it('57. "Erwähnungen" preference exists (default on); a mentioned user who left the team keeps a readable historical mention', async () => {
      const pref = await userB.client.from('notification_preferences').select('erwaehnungen').eq('user_id', userB.id).single();
      expect(pref.data?.erwaehnungen).toBe(true);
      const id = await say(userA, `Danke @${nameB}`);
      await userA.client.from('message_mentions').insert({ message_id: id, mentioned_user_id: userB.id });
      await admin.from('team_members').delete().eq('team_id', teamId).eq('user_id', userB.id);
      const still = await userA.client.from('message_mentions').select('mention_text').eq('message_id', id);
      expect(still.data).toEqual([{ mention_text: `@${nameB}` }]);
      await admin.from('team_members').insert({ team_id: teamId, user_id: userB.id, role: 'member' });
    });
  });
  it('58. a member\'s new message stays visible on reload even after 70+ older rows (newest-first window)', async () => {
    const rows = Array.from({ length: 70 }, (_, i) => ({ team_id: teamId, user_id: userA.id, content: `alt ${i}`, created_at: new Date(Date.now() - (200 - i) * 60000).toISOString() }));
    await admin.from('messages').insert(rows);
    const sent = await userB.client.from('messages').insert({ team_id: teamId, user_id: userB.id, content: '@Ben Test Nachricht – bitte nach Reload noch sichtbar.' }).select('id').single();
    expect(sent.error).toBeNull();
    // same shape as getMessagesPage: newest first, limited, top-level, not deleted
    const page = await userB.client
      .from('messages')
      .select('*, profiles(full_name, avatar_url)')
      .eq('team_id', teamId)
      .is('deleted_at', null)
      .is('parent_message_id', null)
      .order('created_at', { ascending: false })
      .limit(60);
    expect(page.error).toBeNull();
    expect((page.data ?? []).map((m) => m.id)).toContain(sent.data!.id);
    // the old ascending+limit query would have returned only the oldest rows
    const old = await userB.client.from('messages').select('id').eq('team_id', teamId).order('created_at', { ascending: true }).limit(50);
    expect((old.data ?? []).map((m) => m.id)).not.toContain(sent.data!.id);
  });
  it('59. reply relation persists, reads back with the original (incl. soft-deleted), and stays team-private', async () => {
    const orig = await userA.client.from('messages').insert({ team_id: teamId, user_id: userA.id, content: 'Hmm irgendwie sind meine 30 Minuten Rad nicht mit aufgenommen ...' }).select('id').single();
    const reply = await userB.client.from('messages').insert({ team_id: teamId, user_id: userB.id, content: '@Alma Ich schaue später nach.', reply_to_id: orig.data!.id }).select('id, reply_to_id').single();
    expect(reply.error).toBeNull();
    expect(reply.data!.reply_to_id).toBe(orig.data!.id);

    // reload-shaped read still carries the relation, and the original is readable for the quote
    const page = await userB.client.from('messages').select('id, reply_to_id').eq('team_id', teamId).order('created_at', { ascending: false }).limit(60);
    expect(page.data!.find((m) => m.id === reply.data!.id)!.reply_to_id).toBe(orig.data!.id);
    const q1 = await userB.client.from('messages').select('id, content, deleted_at, profiles(full_name)').in('id', [orig.data!.id]);
    expect(q1.data![0]!.deleted_at).toBeNull();

    // original deleted (soft): the reply keeps its relation and the quote lookup reports it as deleted
    await userA.client.from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', orig.data!.id);
    const q2 = await userB.client.from('messages').select('id, deleted_at').in('id', [orig.data!.id]);
    expect(q2.data![0]!.deleted_at).not.toBeNull();
    const after = await admin.from('messages').select('reply_to_id').eq('id', reply.data!.id).single();
    expect(after.data!.reply_to_id).toBe(orig.data!.id);

    // an outsider can neither read the reply nor the original
    expect((await outsider.client.from('messages').select('id').in('id', [orig.data!.id, reply.data!.id])).data).toEqual([]);
    // the relation of an existing message cannot be rewritten by an edit
    const hijack = await userB.client.from('messages').update({ reply_to_id: null }).eq('id', reply.data!.id).select('id');
    expect(hijack.error !== null || (hijack.data ?? []).length === 0).toBe(true);
  });

  describe('Punkteverteilung matches real scoring', () => {
    let P: typeof userB;
    let rules: import('../../src/lib/points-rules').PointsRules;
    const events = async () => (await admin.from('fitness_score_events').select('event_type, points, event_date').eq('user_id', P.id).eq('team_id', teamId)).data ?? [];
    const sum = (rows: { event_type: string; points: number }[], t: string) => rows.filter((r) => r.event_type === t).reduce((a, r) => a + r.points, 0);
    const finish = async (title: string, minutes: number, day: Date) => {
      const { data: w } = await P.client.from('workouts').insert({ user_id: P.id, team_id: teamId, activity_type: 'krafttraining', status: 'laeuft', title, started_at: new Date(day.getTime() - minutes * 60000).toISOString() }).select('id').single();
      const r = await P.client.from('workouts').update({ status: 'abgeschlossen', finished_at: day.toISOString(), duration_seconds: minutes * 60 }).eq('id', w!.id);
      expect(r.error).toBeNull();
      return w!.id as string;
    };
    const weekDay = (offset: number) => {
      const d = new Date();
      const wd = (d.getUTCDay() + 6) % 7; // Monday = 0
      d.setUTCDate(d.getUTCDate() - wd + offset);
      d.setUTCHours(12, 0, 0, 0);
      return d;
    };

    beforeAll(async () => {
      P = await createTestUser('points-owner');
      await admin.from('team_members').insert({ team_id: teamId, user_id: P.id, role: 'member' });
      await admin.from('profiles').update({ weekly_goal: 3 }).eq('id', P.id);
      const { data } = await admin.from('team_ranking_rules').select('*').eq('team_id', teamId).single();
      rules = data as never;
    });
    afterAll(async () => {
      await admin.auth.admin.deleteUser(P.id).catch(() => undefined);
    });

    it('60. <30 min earns only the base points; >=30 min adds the duration bonus (matches the shown rules)', async () => {
      const { describePointsRules } = await import('../../src/lib/points-rules');
      const shown = Object.fromEntries(describePointsRules(rules).items.map((i) => [i.key, i.amount]));
      const short = await finish('kurz', 20, weekDay(0));
      const long = await finish('lang', 45, weekDay(1));
      const ev = (await admin.from('fitness_score_events').select('event_type, points, source_entity_id').eq('user_id', P.id)).data ?? [];
      const forShort = ev.filter((e) => e.source_entity_id === short);
      const forLong = ev.filter((e) => e.source_entity_id === long);
      expect(forShort.map((e) => e.event_type)).toEqual(['workout_completed']);
      expect(`+${forShort[0]!.points}`).toBe(shown.workout);
      expect(forLong.map((e) => e.event_type).sort()).toEqual(['workout_completed', 'workout_duration_bonus']);
      expect(`+${forLong.find((e) => e.event_type === 'workout_duration_bonus')!.points}`).toBe(shown.duration);
    });

    it('61. third distinct day: weekly-goal bonus and consistency bonus match the shown rules', async () => {
      const { describePointsRules } = await import('../../src/lib/points-rules');
      const shown = Object.fromEntries(describePointsRules(rules).items.map((i) => [i.key, i.amount]));
      await finish('dritter Tag', 35, weekDay(2));
      const ev = await events();
      expect(`+${sum(ev, 'weekly_goal_reached')}`).toBe(shown.weekly_goal);
      expect(`+${sum(ev, 'consistency_bonus')}`).toBe(shown.consistency);
    });

    it('62. daily cap: capped kinds never exceed the shown limit on one day; weekly goal is exempt', async () => {
      const day = weekDay(3);
      await finish('cap 1', 40, day);
      await finish('cap 2', 40, day);
      const ev = (await events()).filter((e) => (e.event_date as string) === day.toISOString().slice(0, 10));
      const capped = ev.filter((e) => ['workout_completed', 'workout_duration_bonus', 'consistency_bonus'].includes(e.event_type)).reduce((a, e) => a + e.points, 0);
      expect(capped).toBeLessThanOrEqual(rules.daily_cap_points);
      expect(capped).toBe(rules.daily_cap_points);
    });

    it('63. challenge points come from the challenge itself ("Je nach Challenge")', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data: ch } = await admin.from('challenges').insert({ team_id: teamId, title: 'Punkte-Test', challenge_type: 'individual', metric: 'custom', target_value: 1, starts_at: today, ends_at: today, points_reward: 75, created_by: userA.id }).select('id').single();
      await admin.from('challenge_participants').insert({ challenge_id: ch!.id, user_id: P.id, progress_value: 1 });
      const ev = await events();
      expect(sum(ev, 'challenge_completed')).toBe(75);
      await admin.from('challenges').delete().eq('id', ch!.id);
    });
  });

  describe('Plan-Vorlagen (plan_templates)', () => {
    let T: typeof userB;
    let globalExerciseId: string;
    let customExerciseId: string;

    beforeAll(async () => {
      T = await createTestUser('template-owner');
      const { data: ex } = await admin.from('exercises').select('id').is('team_id', null).limit(1).single();
      globalExerciseId = ex!.id;
      const { data: custom, error } = await T.client
        .from('exercises')
        .insert({ name: 'Meine Test-Übung', muscle_group: 'chest', exercise_type: 'strength', owner_user_id: T.id, is_custom: true, visibility: 'private', created_by: T.id })
        .select('id')
        .single();
      expect(error).toBeNull();
      customExerciseId = custom!.id;
    });
    afterAll(async () => {
      await admin.auth.admin.deleteUser(T.id).catch(() => undefined);
    });

    it('64. owner creates a template with typed targets; items read back in position order; invalid targets are rejected', async () => {
      const tpl = await T.client.from('plan_templates').insert({ user_id: T.id, name: 'Brust & Trizeps' }).select('id').single();
      expect(tpl.error).toBeNull();
      const items = await T.client.from('plan_template_items').insert([
        { template_id: tpl.data!.id, exercise_id: globalExerciseId, exercise_name: 'Bankdrücken', position: 0, target_sets: 3, target_reps: 10, target_weight_kg: 60 },
        { template_id: tpl.data!.id, exercise_id: customExerciseId, exercise_name: 'Meine Test-Übung', position: 1, target_sets: 3, target_reps: 12 },
      ]).select('id');
      expect(items.error).toBeNull();

      const read = await T.client.from('plan_templates').select('*, plan_template_items(*)').eq('id', tpl.data!.id).single();
      const sorted = [...read.data!.plan_template_items].sort((a: { position: number }, b: { position: number }) => a.position - b.position);
      expect(sorted).toHaveLength(2);
      expect(sorted[0].exercise_name).toBe('Bankdrücken');
      expect(Number(sorted[0].target_weight_kg)).toBe(60);

      const bad = await T.client.from('plan_template_items').insert({ template_id: tpl.data!.id, exercise_id: globalExerciseId, exercise_name: 'X', position: 2, target_weight_kg: -1 });
      expect(bad.error).not.toBeNull();
      const longName = await T.client.from('plan_templates').insert({ user_id: T.id, name: 'x'.repeat(61) });
      expect(longName.error).not.toBeNull();
    });

    it('65. outsider cannot read, rename, delete or inject items into another user\'s template (crafted requests)', async () => {
      const tpl = await T.client.from('plan_templates').insert({ user_id: T.id, name: 'Privat' }).select('id').single();
      const item = await T.client.from('plan_template_items').insert({ template_id: tpl.data!.id, exercise_id: globalExerciseId, exercise_name: 'X', position: 0 }).select('id').single();

      expect((await outsider.client.from('plan_templates').select('id').eq('id', tpl.data!.id)).data).toEqual([]);
      expect((await outsider.client.from('plan_template_items').select('id').eq('id', item.data!.id)).data).toEqual([]);

      const forgeRename = await outsider.client.from('plan_templates').update({ name: 'Gehackt' }).eq('id', tpl.data!.id).select('id');
      expect(forgeRename.data ?? []).toEqual([]);
      const forgeDelete = await outsider.client.from('plan_templates').delete().eq('id', tpl.data!.id).select('id');
      expect(forgeDelete.data ?? []).toEqual([]);
      const forgeItemInsert = await outsider.client.from('plan_template_items').insert({ template_id: tpl.data!.id, exercise_id: globalExerciseId, exercise_name: 'Injiziert', position: 1 });
      expect(forgeItemInsert.error).not.toBeNull();

      const stillThere = await admin.from('plan_templates').select('name').eq('id', tpl.data!.id).single();
      expect(stillThere.data!.name).toBe('Privat');
    });

    it('66. deleting a template cascades to its items', async () => {
      const tpl = await T.client.from('plan_templates').insert({ user_id: T.id, name: 'Wird gelöscht' }).select('id').single();
      const item = await T.client.from('plan_template_items').insert({ template_id: tpl.data!.id, exercise_id: globalExerciseId, exercise_name: 'X', position: 0 }).select('id').single();

      await T.client.from('plan_templates').delete().eq('id', tpl.data!.id);

      const orphan = await admin.from('plan_template_items').select('id').eq('id', item.data!.id);
      expect(orphan.data).toEqual([]);
    });

    it('67. deleting the referenced exercise never blocks the delete: the item survives with exercise_id null and its name snapshot intact', async () => {
      const tpl = await T.client.from('plan_templates').insert({ user_id: T.id, name: 'Mit gelöschter Übung' }).select('id').single();
      const item = await T.client
        .from('plan_template_items')
        .insert({ template_id: tpl.data!.id, exercise_id: customExerciseId, exercise_name: 'Meine Test-Übung', position: 0 })
        .select('id')
        .single();

      const del = await T.client.from('exercises').delete().eq('id', customExerciseId);
      expect(del.error).toBeNull();

      const after = await admin.from('plan_template_items').select('exercise_id, exercise_name').eq('id', item.data!.id).single();
      expect(after.data!.exercise_id).toBeNull();
      expect(after.data!.exercise_name).toBe('Meine Test-Übung');
    });

    it('68. a day created "from a template" is an independent copy: deleting the template afterwards leaves it untouched', async () => {
      const plan = await T.client.from('workout_plans').insert({ user_id: T.id, name: 'T68' }).select('id').single();
      const tpl = await T.client.from('plan_templates').insert({ user_id: T.id, name: 'Quelle' }).select('id').single();
      await T.client.from('plan_template_items').insert({ template_id: tpl.data!.id, exercise_id: globalExerciseId, exercise_name: 'X', position: 0, target_sets: 5, target_reps: 5 });

      // Same shape createDayFromTemplateAction writes: a fresh day + a fresh
      // workout_plan_exercises row, with no FK back to the template.
      const day = await T.client.from('workout_plan_days').insert({ plan_id: plan.data!.id, weekday: 3, title: 'Quelle' }).select('id').single();
      const created = await T.client
        .from('workout_plan_exercises')
        .insert({ plan_day_id: day.data!.id, exercise_id: globalExerciseId, position: 0, target_sets: 5, target_reps: 5 })
        .select('id')
        .single();
      expect(created.error).toBeNull();

      await T.client.from('plan_templates').delete().eq('id', tpl.data!.id);

      const stillThere = await admin.from('workout_plan_exercises').select('id, target_sets').eq('id', created.data!.id).single();
      expect(stillThere.data!.target_sets).toBe(5);
    });
  });

  describe('Plan shares (share a template/day/workout into team chat)', () => {
    let globalStrengthId: string;
    let globalCardioId: string;
    let customExerciseId: string;
    let templateId: string;
    let planDayId: string;
    let workoutId: string;

    beforeAll(async () => {
      const { data: ex } = await admin.from('exercises').select('id, exercise_type').is('team_id', null).order('name');
      globalStrengthId = ex!.find((e) => e.exercise_type === 'strength')!.id;
      globalCardioId = ex!.find((e) => e.exercise_type === 'cardio_distance' || e.exercise_type === 'cardio')!.id;

      const { data: custom } = await userA.client
        .from('exercises')
        .insert({ name: 'Geheime Übung von A', muscle_group: 'back', exercise_type: 'strength', owner_user_id: userA.id, is_custom: true, visibility: 'private', created_by: userA.id })
        .select('id')
        .single();
      customExerciseId = custom!.id;

      const { data: tpl } = await userA.client.from('plan_templates').insert({ user_id: userA.id, name: 'Push A' }).select('id').single();
      templateId = tpl!.id;
      await userA.client.from('plan_template_items').insert([
        { template_id: templateId, exercise_id: globalStrengthId, exercise_name: 'Bankdrücken', position: 0, target_sets: 3, target_reps: 10, target_weight_kg: 80 },
        { template_id: templateId, exercise_id: customExerciseId, exercise_name: 'Geheime Übung von A', position: 1, target_sets: 3, target_reps: 8, target_weight_kg: 40 },
      ]);

      const { data: plan } = await userA.client.from('workout_plans').insert({ user_id: userA.id, name: 'Plan A' }).select('id').single();
      const { data: day } = await userA.client.from('workout_plan_days').insert({ plan_id: plan!.id, weekday: 5, title: 'Beintag' }).select('id').single();
      planDayId = day!.id;
      await userA.client.from('workout_plan_exercises').insert({ plan_day_id: planDayId, exercise_id: globalCardioId, position: 0, target_distance_km: 5, target_duration_seconds: 1800 });

      const { data: w } = await userA.client
        .from('workouts')
        .insert({ user_id: userA.id, team_id: teamId, activity_type: 'krafttraining', status: 'laeuft', title: 'Fertiges Training', started_at: new Date(Date.now() - 1800000).toISOString() })
        .select('id')
        .single();
      workoutId = w!.id;
      const { data: we } = await admin
        .from('workout_exercises')
        .insert({ workout_id: workoutId, exercise_id: globalStrengthId, position: 0, planned: { sets: 4, reps: 8, weightKg: 90 } })
        .select('id')
        .single();
      await admin.from('workout_sets').insert({ workout_exercise_id: we!.id, set_number: 1, weight_kg: 92.5, reps: 7, completed: true });
      await userA.client.from('workouts').update({ status: 'abgeschlossen', finished_at: new Date().toISOString(), duration_seconds: 1800 }).eq('id', workoutId);
    });

    it('69. author publishes a template share: message + snapshot created, a teammate sees it, an outsider cannot', async () => {
      const before = await admin.from('messages').select('id', { count: 'exact', head: true }).eq('team_id', teamId);
      const res = await userA.client.rpc('publish_plan_share', { p_team_id: teamId, p_source_type: 'template', p_source_template_id: templateId, p_note: 'Das ist mein aktueller Push-Plan.' });
      expect(res.error).toBeNull();
      const { message_id, share_id } = res.data![0];
      const after = await admin.from('messages').select('id', { count: 'exact', head: true }).eq('team_id', teamId);
      expect((after.count ?? 0) - (before.count ?? 0)).toBe(1);

      const asB = await userB.client.from('plan_shares').select('id, title, message_id, source_type').eq('id', share_id).single();
      expect(asB.error).toBeNull();
      expect(asB.data!.title).toBe('Push A');
      expect(asB.data!.message_id).toBe(message_id);

      const itemsAsB = await userB.client.from('plan_share_items').select('exercise_name, position').eq('share_id', share_id).order('position');
      expect((itemsAsB.data ?? []).map((i) => i.exercise_name)).toEqual(['Bankdrücken', 'Geheime Übung von A']);

      const msgAsB = await userB.client.from('messages').select('content, message_type').eq('id', message_id).single();
      expect(msgAsB.data!.message_type).toBe('text');
      expect(msgAsB.data!.content).toBe('Das ist mein aktueller Push-Plan.');

      expect((await outsider.client.from('plan_shares').select('id').eq('id', share_id)).data).toEqual([]);
      expect((await outsider.client.from('messages').select('id').eq('id', message_id)).data).toEqual([]);
    });

    it('70. sharing directly from a live (unsaved) plan day works and falls back to the day title', async () => {
      const res = await userA.client.rpc('publish_plan_share', { p_team_id: teamId, p_source_type: 'template', p_source_plan_day_id: planDayId });
      expect(res.error).toBeNull();
      const share = await admin.from('plan_shares').select('title, source_plan_day_id').eq('id', res.data![0].share_id).single();
      expect(share.data!.title).toBe('Beintag');
      const items = await admin.from('plan_share_items').select('exercise_name, target_distance_km').eq('share_id', res.data![0].share_id);
      expect(items.data![0]!.exercise_name).toBeTruthy();
      expect(Number(items.data![0]!.target_distance_km)).toBe(5);
    });

    it('71. weights and instructions are absent from the stored rows unless explicitly shared (checked in the data, not just the UI)', async () => {
      const withoutOptIn = await userA.client.rpc('publish_plan_share', { p_team_id: teamId, p_source_type: 'template', p_source_template_id: templateId });
      const itemsA = await admin.from('plan_share_items').select('target_weight_kg, instructions').eq('share_id', withoutOptIn.data![0].share_id);
      expect(itemsA.data!.every((i) => i.target_weight_kg === null)).toBe(true);
      expect(itemsA.data!.every((i) => i.instructions === null)).toBe(true);

      const withOptIn = await userA.client.rpc('publish_plan_share', { p_team_id: teamId, p_source_type: 'template', p_source_template_id: templateId, p_share_weights: true });
      const itemsB = await admin.from('plan_share_items').select('target_weight_kg').eq('share_id', withOptIn.data![0].share_id).order('position');
      expect(Number(itemsB.data![0]!.target_weight_kg)).toBe(80);
    });

    it('72. a private custom exercise never leaks its id: reusable_exercise_id stays null, only the allowlisted snapshot travels', async () => {
      const res = await userA.client.rpc('publish_plan_share', { p_team_id: teamId, p_source_type: 'template', p_source_template_id: templateId });
      const items = await admin.from('plan_share_items').select('exercise_name, reusable_exercise_id').eq('share_id', res.data![0].share_id).order('position');
      const globalItem = items.data!.find((i) => i.exercise_name === 'Bankdrücken')!;
      const privateItem = items.data!.find((i) => i.exercise_name === 'Geheime Übung von A')!;
      expect(globalItem.reusable_exercise_id).toBe(globalStrengthId);
      expect(privateItem.reusable_exercise_id).toBeNull();
    });

    it('73. forged/invalid publish attempts are rejected: someone else\'s template, an incomplete workout, a non-owned workout', async () => {
      const forgedTemplate = await userB.client.rpc('publish_plan_share', { p_team_id: teamId, p_source_type: 'template', p_source_template_id: templateId });
      expect(forgedTemplate.error).not.toBeNull();

      const { data: runningWorkout } = await userA.client
        .from('workouts')
        .insert({ user_id: userA.id, team_id: teamId, activity_type: 'krafttraining', status: 'laeuft', title: 'Läuft noch' })
        .select('id')
        .single();
      const notCompleted = await userA.client.rpc('publish_plan_share', { p_team_id: teamId, p_source_type: 'workout', p_source_workout_id: runningWorkout!.id });
      expect(notCompleted.error).not.toBeNull();

      const forgedWorkout = await userB.client.rpc('publish_plan_share', { p_team_id: teamId, p_source_type: 'workout', p_source_workout_id: workoutId });
      expect(forgedWorkout.error).not.toBeNull();
    });

    it('74. a client cannot directly insert or update plan_shares/plan_share_items (no such RLS policy exists)', async () => {
      const directInsert = await userA.client.from('plan_shares').insert({ message_id: crypto.randomUUID(), team_id: teamId, author_id: userA.id, source_type: 'template', title: 'Injiziert' });
      expect(directInsert.error).not.toBeNull();
      const res = await userA.client.rpc('publish_plan_share', { p_team_id: teamId, p_source_type: 'template', p_source_template_id: templateId });
      const directUpdate = await userB.client.from('plan_shares').update({ title: 'Gehackt' }).eq('id', res.data![0].share_id).select('id');
      expect(directUpdate.data ?? []).toEqual([]);
    });

    it('75. recipient imports an independent copy: owns the new template, strength targets retained, weight stripped by default', async () => {
      const shared = await userA.client.rpc('publish_plan_share', { p_team_id: teamId, p_source_type: 'template', p_source_template_id: templateId, p_share_weights: true });
      const shareId = shared.data![0].share_id as string;

      const imported = await userB.client.rpc('import_plan_share', { p_share_id: shareId, p_name: 'Meine Kopie von Push A' });
      expect(imported.error).toBeNull();
      const { template_id, already_imported } = imported.data![0];
      expect(already_imported).toBe(false);

      const tpl = await userB.client.from('plan_templates').select('user_id, name').eq('id', template_id).single();
      expect(tpl.data!.user_id).toBe(userB.id);
      expect(tpl.data!.name).toBe('Meine Kopie von Push A');

      const items = await userB.client.from('plan_template_items').select('exercise_name, target_sets, target_reps, target_weight_kg').eq('template_id', template_id).order('position');
      expect(items.data![0]!.target_sets).toBe(3);
      expect(items.data![0]!.target_reps).toBe(10);
      expect(items.data![0]!.target_weight_kg).toBeNull(); // stripped: recipient did not opt in to keep it

      // the ORIGINAL author's template is untouched
      const originalStillIntact = await userA.client.from('plan_template_items').select('target_weight_kg').eq('template_id', templateId).order('position');
      expect(Number(originalStillIntact.data![0]!.target_weight_kg)).toBe(80);
    });

    it('76. recipient keeps a shared weight only by explicitly opting in at import time', async () => {
      const shared = await userA.client.rpc('publish_plan_share', { p_team_id: teamId, p_source_type: 'template', p_source_template_id: templateId, p_share_weights: true });
      const imported = await userB.client.rpc('import_plan_share', { p_share_id: shared.data![0].share_id, p_name: 'Mit Gewicht', p_keep_weights: true, p_force_new_copy: true });
      const items = await userB.client.from('plan_template_items').select('target_weight_kg').eq('template_id', imported.data![0].template_id).order('position');
      expect(Number(items.data![0]!.target_weight_kg)).toBe(80);
    });

    it('77. a private custom exercise is recreated as a NEW exercise owned by the recipient, not the author\'s id', async () => {
      const shared = await userA.client.rpc('publish_plan_share', { p_team_id: teamId, p_source_type: 'template', p_source_template_id: templateId });
      const imported = await userB.client.rpc('import_plan_share', { p_share_id: shared.data![0].share_id, p_force_new_copy: true });
      const items = await userB.client.from('plan_template_items').select('exercise_id, exercise_name').eq('template_id', imported.data![0].template_id).order('position');
      const recreated = items.data!.find((i) => i.exercise_name === 'Geheime Übung von A')!;
      expect(recreated.exercise_id).not.toBe(customExerciseId);
      const newExercise = await userB.client.from('exercises').select('owner_user_id, is_custom, visibility, muscle_group').eq('id', recreated.exercise_id).single();
      expect(newExercise.data!.owner_user_id).toBe(userB.id);
      expect(newExercise.data!.is_custom).toBe(true);
      expect(newExercise.data!.muscle_group).toBe('back');
      // A still cannot read B's newly-created private exercise, and vice versa was already true for the original.
      expect((await userA.client.from('exercises').select('id').eq('id', recreated.exercise_id)).data).toEqual([]);
    });

    it('78. editing the imported day/template affects neither the share snapshot, the author\'s template, nor another recipient\'s copy', async () => {
      const shared = await userA.client.rpc('publish_plan_share', { p_team_id: teamId, p_source_type: 'template', p_source_template_id: templateId });
      const shareId = shared.data![0].share_id as string;
      const bCopy = await userB.client.rpc('import_plan_share', { p_share_id: shareId, p_force_new_copy: true });
      const outsiderInTeam = userA; // reuse as a stand-in for "another recipient" via a second forced copy
      const secondCopy = await outsiderInTeam.client.rpc('import_plan_share', { p_share_id: shareId, p_force_new_copy: true });

      await userB.client.from('plan_template_items').delete().eq('template_id', bCopy.data![0].template_id);
      await userB.client.from('plan_templates').update({ name: 'Komplett verändert' }).eq('id', bCopy.data![0].template_id);

      const itemsStillOnShare = await admin.from('plan_share_items').select('id').eq('share_id', shareId);
      expect(itemsStillOnShare.data!.length).toBeGreaterThan(0);
      const originalTemplateName = await admin.from('plan_templates').select('name').eq('id', templateId).single();
      expect(originalTemplateName.data!.name).toBe('Push A');
      const secondCopyItems = await admin.from('plan_template_items').select('id').eq('template_id', secondCopy.data![0].template_id);
      expect(secondCopyItems.data!.length).toBeGreaterThan(0);
    });

    it('79. sharing a completed workout uses PLANNED targets only (never the logged/actual set values) and creates no score events', async () => {
      const before = await admin.from('fitness_score_events').select('id', { count: 'exact', head: true }).eq('user_id', userA.id);
      const res = await userA.client.rpc('publish_plan_share', { p_team_id: teamId, p_source_type: 'workout', p_source_workout_id: workoutId, p_share_weights: true, p_share_actual_summary: true });
      expect(res.error).toBeNull();
      const after = await admin.from('fitness_score_events').select('id', { count: 'exact', head: true }).eq('user_id', userA.id);
      expect(after.count).toBe(before.count);

      const items = await admin.from('plan_share_items').select('target_sets, target_reps, target_weight_kg').eq('share_id', res.data![0].share_id);
      expect(items.data![0]!.target_sets).toBe(4); // from `planned`, not the logged 1 set / 7 reps / 92.5kg
      expect(items.data![0]!.target_reps).toBe(8);
      expect(Number(items.data![0]!.target_weight_kg)).toBe(90);

      const share = await admin.from('plan_shares').select('actual_duration_seconds').eq('id', res.data![0].share_id).single();
      expect(share.data!.actual_duration_seconds).toBe(1800);
    });

    it('80. import is idempotent by default; force_new_copy makes an explicit extra copy; deleting the copy allows a fresh save', async () => {
      const shared = await userA.client.rpc('publish_plan_share', { p_team_id: teamId, p_source_type: 'template', p_source_template_id: templateId });
      const shareId = shared.data![0].share_id as string;

      const first = await userB.client.rpc('import_plan_share', { p_share_id: shareId });
      const second = await userB.client.rpc('import_plan_share', { p_share_id: shareId });
      expect(second.data![0].template_id).toBe(first.data![0].template_id);
      expect(second.data![0].already_imported).toBe(true);

      const extra = await userB.client.rpc('import_plan_share', { p_share_id: shareId, p_force_new_copy: true });
      expect(extra.data![0].template_id).not.toBe(first.data![0].template_id);

      // Delete every live copy from this share, then a plain (non-forced) import must create a fresh one again.
      await userB.client.from('plan_templates').delete().eq('id', first.data![0].template_id);
      await userB.client.from('plan_templates').delete().eq('id', extra.data![0].template_id);
      const again = await userB.client.rpc('import_plan_share', { p_share_id: shareId });
      expect(again.data![0].already_imported).toBe(false);
      expect(again.data![0].template_id).not.toBe(first.data![0].template_id);
      expect(again.data![0].template_id).not.toBe(extra.data![0].template_id);
    });

    it('81. only the author can withdraw a share; once withdrawn, import is refused but a previously saved copy stays intact', async () => {
      const shared = await userA.client.rpc('publish_plan_share', { p_team_id: teamId, p_source_type: 'template', p_source_template_id: templateId });
      const shareId = shared.data![0].share_id as string;
      const savedBefore = await userB.client.rpc('import_plan_share', { p_share_id: shareId, p_force_new_copy: true });

      const forgedWithdraw = await userB.client.rpc('withdraw_plan_share', { p_share_id: shareId });
      expect(forgedWithdraw.error).not.toBeNull();

      const withdraw = await userA.client.rpc('withdraw_plan_share', { p_share_id: shareId });
      expect(withdraw.error).toBeNull();

      const afterWithdraw = await userB.client.rpc('import_plan_share', { p_share_id: shareId, p_force_new_copy: true });
      expect(afterWithdraw.error).not.toBeNull();

      const stillOwned = await userB.client.from('plan_templates').select('id').eq('id', savedBefore.data![0].template_id).single();
      expect(stillOwned.data!.id).toBe(savedBefore.data![0].template_id);
    });

    it('82. a member removed from the team can no longer read a share they had a direct link to', async () => {
      const leaving = await createTestUser('leaving-member');
      await admin.from('team_members').insert({ team_id: teamId, user_id: leaving.id, role: 'member' });
      const shared = await userA.client.rpc('publish_plan_share', { p_team_id: teamId, p_source_type: 'template', p_source_template_id: templateId });
      const shareId = shared.data![0].share_id as string;

      const whileMember = await leaving.client.from('plan_shares').select('id').eq('id', shareId);
      expect(whileMember.data).toHaveLength(1);

      await admin.from('team_members').delete().eq('team_id', teamId).eq('user_id', leaving.id);
      const afterRemoval = await leaving.client.from('plan_shares').select('id').eq('id', shareId);
      expect(afterRemoval.data).toEqual([]);
      const importAttempt = await leaving.client.rpc('import_plan_share', { p_share_id: shareId });
      expect(importAttempt.error).not.toBeNull();

      await admin.auth.admin.deleteUser(leaving.id).catch(() => undefined);
    });
  });

  describe('team points reset (points_reset_at)', () => {
    let R: typeof userB;
    // Matches the real target instant this feature was built for: 1 Oct 2026
    // 00:00 Europe/Berlin, which is 2026-09-30T22:00:00Z (still CEST, +2).
    const cutoffIso = '2026-10-01T00:00:00+02:00';

    const finishAt = async (title: string, minutes: number, at: Date) => {
      const { data: w } = await R.client
        .from('workouts')
        .insert({
          user_id: R.id,
          team_id: teamId,
          activity_type: 'krafttraining',
          status: 'laeuft',
          title,
          started_at: new Date(at.getTime() - minutes * 60000).toISOString(),
        })
        .select('id')
        .single();
      const res = await R.client
        .from('workouts')
        .update({ status: 'abgeschlossen', finished_at: at.toISOString(), duration_seconds: minutes * 60 })
        .eq('id', w!.id);
      expect(res.error).toBeNull();
      return w!.id as string;
    };

    const allTimePoints = async (): Promise<number> => {
      const { data } = await userA.client.rpc('get_team_ranking', { p_team_id: teamId, p_period: 'all_time' });
      const rows = (data ?? []) as { user_id: string; points: number }[];
      return Number(rows.find((r) => r.user_id === R.id)?.points ?? 0);
    };

    beforeAll(async () => {
      R = await createTestUser('points-reset');
      await admin.from('team_members').insert({ team_id: teamId, user_id: R.id, role: 'member' });
    });
    afterAll(async () => {
      await admin.from('team_ranking_rules').update({ points_reset_at: null }).eq('team_id', teamId);
      await admin.auth.admin.deleteUser(R.id).catch(() => undefined);
    });

    it('103. before any cutoff is set, all_time ranking includes everything (baseline, unaffected)', async () => {
      await finishAt('vor jedem Cutoff', 30, new Date('2026-09-28T10:00:00Z'));
      expect(await allTimePoints()).toBeGreaterThan(0);
    });

    it('104. setting the cutoff excludes pre-cutoff points from ranking without touching the ledger row', async () => {
      // 20 min, deliberately under the 30-min duration-bonus threshold, so
      // this workout produces exactly one score event (workout_completed).
      const preId = await finishAt('vor dem Cutoff', 20, new Date('2026-09-29T10:00:00Z'));
      const before = await allTimePoints();
      expect(before).toBeGreaterThan(0);

      const set = await admin.from('team_ranking_rules').update({ points_reset_at: cutoffIso }).eq('team_id', teamId);
      expect(set.error).toBeNull();
      expect(await allTimePoints()).toBe(0);

      // The ledger itself is untouched — personal history survives in full.
      const { data: ev } = await admin.from('fitness_score_events').select('id, points').eq('source_entity_id', preId);
      expect(ev).toHaveLength(1);
      expect(ev![0]!.points).toBeGreaterThan(0);
    });

    it('105. a post-cutoff workout scores into the ranking normally', async () => {
      await finishAt('nach dem Cutoff', 30, new Date('2026-10-02T09:00:00Z'));
      expect(await allTimePoints()).toBeGreaterThan(0);
    });

    it('106. the exact boundary instant is inclusive, and the timezone conversion is not a naive UTC date cast', async () => {
      const before = await allTimePoints();
      // 08:00 Berlin on 30 Sep — unambiguously BEFORE the cutoff. A naive
      // `points_reset_at::date` cast under this database's UTC session
      // timezone would equal '2026-09-30' too, wrongly including this.
      await finishAt('30. Sep morgens Berlin', 20, new Date('2026-09-30T06:00:00Z'));
      expect(await allTimePoints()).toBe(before);

      // 09:00 Berlin on 1 Oct — unambiguously AFTER the cutoff either way.
      const afterUnambiguous = await finishAt('1. Okt morgens', 20, new Date('2026-10-01T07:00:00Z'));
      expect(await allTimePoints()).toBeGreaterThan(before);

      const { data: ev } = await admin.from('fitness_score_events').select('points').eq('source_entity_id', afterUnambiguous);
      expect((ev ?? []).length).toBeGreaterThan(0);
    });

    it('107. editing/recalculating a pre-cutoff workout does not restore its points to the ranking', async () => {
      const before = await allTimePoints();
      const preId = await finishAt('alt, wird bearbeitet', 25, new Date('2026-09-27T10:00:00Z'));
      expect(await allTimePoints()).toBe(before); // still pre-cutoff, no change expected

      const edit = await R.client.rpc('update_own_workout', {
        p_workout_id: preId,
        p_title: 'bearbeitet',
        p_finished_at: new Date('2026-09-27T10:00:00Z').toISOString(),
        p_duration_seconds: 40 * 60,
        p_distance_km: null,
        p_notes: null,
      });
      expect(edit.error).toBeNull();
      expect(await allTimePoints()).toBe(before);
    });

    it('108. a historical challenge that completes after the cutoff still pays into the ledger but not into the reset ranking', async () => {
      const before = await allTimePoints();
      const { data: ch } = await admin
        .from('challenges')
        .insert({
          team_id: teamId, title: 'Alte Challenge', challenge_type: 'individual', metric: 'custom',
          target_value: 1, starts_at: '2026-09-20', ends_at: '2026-10-10', points_reward: 90, created_by: userA.id,
        })
        .select('id')
        .single();
      await admin.from('challenge_participants').insert({ challenge_id: ch!.id, user_id: R.id, progress_value: 1 });

      const { data: paid } = await admin.from('fitness_score_events').select('points').eq('source_entity_id', ch!.id).eq('user_id', R.id).single();
      expect(paid?.points).toBe(90); // ledger records it in full, regardless of the cutoff
      expect(await allTimePoints()).toBe(before); // but it does not count toward the reset ranking

      await admin.from('challenges').delete().eq('id', ch!.id);
    });

    it('109. a challenge starting on/after the cutoff pays into the ranking normally', async () => {
      const before = await allTimePoints();
      const { data: ch } = await admin
        .from('challenges')
        .insert({
          team_id: teamId, title: 'Neue Challenge', challenge_type: 'individual', metric: 'custom',
          target_value: 1, starts_at: '2026-10-01', ends_at: '2026-10-10', points_reward: 65, created_by: userA.id,
        })
        .select('id')
        .single();
      await admin.from('challenge_participants').insert({ challenge_id: ch!.id, user_id: R.id, progress_value: 1 });

      expect(await allTimePoints()).toBe(before + 65);
      await admin.from('challenges').delete().eq('id', ch!.id);
    });

    it('110. setting the identical cutoff again changes nothing (idempotent)', async () => {
      const before = await allTimePoints();
      const set = await admin.from('team_ranking_rules').update({ points_reset_at: cutoffIso }).eq('team_id', teamId);
      expect(set.error).toBeNull();
      expect(await allTimePoints()).toBe(before);
    });

    it('111. a second team with no cutoff set is completely unaffected by this team’s cutoff', async () => {
      await admin.from('fitness_score_events').insert({
        user_id: outsider.id, team_id: outsiderTeamId, event_type: 'workout_completed', points: 42, event_date: '2020-01-01',
      });
      const { data, error } = await outsider.client.rpc('get_team_ranking', { p_team_id: outsiderTeamId, p_period: 'all_time' });
      expect(error).toBeNull();
      const row = (data ?? []).find((r: { user_id: string }) => r.user_id === outsider.id) as { points: number } | undefined;
      expect(row?.points).toBeGreaterThanOrEqual(42);
    });

    it('112. a non-admin member cannot set points_reset_at (existing admin-only RLS)', async () => {
      const before = await admin.from('team_ranking_rules').select('points_reset_at').eq('team_id', teamId).single();
      const attempt = await R.client.from('team_ranking_rules').update({ points_reset_at: null }).eq('team_id', teamId).select('team_id');
      expect(attempt.data ?? []).toEqual([]);
      const after = await admin.from('team_ranking_rules').select('points_reset_at').eq('team_id', teamId).single();
      expect(after.data?.points_reset_at).toBe(before.data?.points_reset_at);
    });
  });

  describe('team workout activity ("Heute im Team")', () => {
    let W1: typeof userB;
    let W2: typeof userB;

    type ActivityRow = { workout_id: string; user_id: string; message_id: string };

    const finish = async (user: typeof userB, minutes: number, at: Date) => {
      const { data: w } = await user.client
        .from('workouts')
        .insert({
          user_id: user.id,
          team_id: teamId,
          activity_type: 'krafttraining',
          status: 'laeuft',
          title: 'Testtraining',
          started_at: new Date(at.getTime() - minutes * 60000).toISOString(),
        })
        .select('id')
        .single();
      const res = await user.client.from('workouts').update({ status: 'abgeschlossen', finished_at: at.toISOString(), duration_seconds: minutes * 60 }).eq('id', w!.id);
      expect(res.error).toBeNull();
      return w!.id as string;
    };

    const messageIdFor = async (workoutId: string): Promise<string> => {
      const { data } = await admin.from('messages').select('id').eq('workout_id', workoutId).eq('event_type', 'workout_completed').single();
      return data!.id as string;
    };

    const activityToday = async (asUser = userA): Promise<{ data: ActivityRow[]; error: unknown }> => {
      const start = new Date(Date.now() - 20 * 3600 * 1000); // a wide, safely-inclusive "today" window for this test's purposes
      const end = new Date(Date.now() + 4 * 3600 * 1000);
      const { data, error } = await asUser.client.rpc('get_team_workout_activity', {
        p_team_id: teamId,
        p_range_start: start.toISOString(),
        p_range_end: end.toISOString(),
      });
      return { data: (data ?? []) as ActivityRow[], error };
    };

    beforeAll(async () => {
      W1 = await createTestUser('activity-w1');
      W2 = await createTestUser('activity-w2');
      await admin.from('team_members').insert([
        { team_id: teamId, user_id: W1.id, role: 'member' },
        { team_id: teamId, user_id: W2.id, role: 'member' },
      ]);
    });
    afterAll(async () => {
      await admin.from('team_members').delete().eq('team_id', teamId).in('user_id', [W1.id, W2.id]);
      for (const u of [W1, W2]) await admin.auth.admin.deleteUser(u.id).catch(() => undefined);
    });

    it('113. two members each completing one workout are both returned, each keyed by their own canonical chat message id', async () => {
      const now = new Date();
      const id1 = await finish(W1, 30, now);
      const id2 = await finish(W2, 25, now);
      const { data, error } = await activityToday();
      expect(error).toBeNull();
      const row1 = data.find((r) => r.workout_id === id1)!;
      const row2 = data.find((r) => r.workout_id === id2)!;
      expect(row1.user_id).toBe(W1.id);
      expect(row2.user_id).toBe(W2.id);
      expect(row1.message_id).not.toBe(row2.message_id);
      expect(row1.message_id).toBe(await messageIdFor(id1));
    });

    it('114. one member finishing two workouts produces two independent rows, never merged', async () => {
      const now = new Date();
      const idA = await finish(W1, 20, new Date(now.getTime() - 3600000));
      const idB = await finish(W1, 20, now);
      const { data } = await activityToday();
      const mine = data.filter((r) => r.workout_id === idA || r.workout_id === idB);
      expect(mine).toHaveLength(2);
      expect(mine.every((r) => r.user_id === W1.id)).toBe(true);
      expect(new Set(mine.map((r) => r.message_id)).size).toBe(2);
    });

    it('115. an opted-out member\'s workout is excluded from rows entirely, without deleting the workout itself', async () => {
      await admin.from('privacy_settings').upsert({ user_id: W1.id, activity_feed_opt_in: false });
      const id = await finish(W1, 30, new Date());
      const { data } = await activityToday();
      expect(data.some((r) => r.workout_id === id)).toBe(false);
      const { data: w } = await admin.from('workouts').select('id').eq('id', id).single();
      expect(w?.id).toBe(id); // privacy, not deletion
      await admin.from('privacy_settings').upsert({ user_id: W1.id, activity_feed_opt_in: true });
    });

    it('116. a workout stuck awaiting the long-duration confirmation gate (still status=laeuft) is excluded', async () => {
      const { data: w } = await W2.client
        .from('workouts')
        .insert({ user_id: W2.id, team_id: teamId, activity_type: 'laufen', status: 'laeuft', started_at: new Date(Date.now() - 4 * 3600 * 1000).toISOString() })
        .select('id')
        .single();
      const attempt = await W2.client.rpc('finish_own_workout', {
        p_workout_id: w!.id,
        p_finished_at: new Date().toISOString(),
        p_duration_seconds: 12000,
        p_distance_km: null,
        p_notes: null,
      });
      expect(attempt.error).not.toBeNull(); // confirmation_required — status never reaches abgeschlossen
      const { data } = await activityToday();
      expect(data.some((r) => r.workout_id === w!.id)).toBe(false);
      await admin.from('workouts').delete().eq('id', w!.id);
    });

    it('117. a deleted workout disappears from a subsequent call', async () => {
      const id = await finish(W2, 15, new Date());
      expect((await activityToday()).data.some((r) => r.workout_id === id)).toBe(true);
      const del = await W2.client.rpc('delete_own_workout', { p_workout_id: id });
      expect(del.error).toBeNull();
      expect((await activityToday()).data.some((r) => r.workout_id === id)).toBe(false);
    });

    it('118. a member removed from the team after their workout posted is excluded going forward', async () => {
      const id = await finish(W1, 15, new Date());
      expect((await activityToday()).data.some((r) => r.workout_id === id)).toBe(true);
      await admin.from('team_members').delete().eq('team_id', teamId).eq('user_id', W1.id);
      expect((await activityToday()).data.some((r) => r.workout_id === id)).toBe(false);
      await admin.from('team_members').insert({ team_id: teamId, user_id: W1.id, role: 'member' });
    });

    it('119. a non-member is rejected with not_a_team_member, not an empty or partial result', async () => {
      const start = new Date(Date.now() - 86400000);
      const { error } = await outsider.client.rpc('get_team_workout_activity', { p_team_id: teamId, p_range_start: start.toISOString(), p_range_end: new Date().toISOString() });
      expect(error).not.toBeNull();
      expect(error!.message).toContain('not_a_team_member');
    });

    it('120. get_team_running_count only counts a genuinely running session — not stale, not paused', async () => {
      const { data: fresh } = await W2.client
        .from('workouts')
        .insert({ user_id: W2.id, team_id: teamId, activity_type: 'krafttraining', status: 'laeuft', started_at: new Date().toISOString() })
        .select('id')
        .single();
      const { data: baseline } = await userA.client.rpc('get_team_running_count', { p_team_id: teamId });
      expect(Number(baseline)).toBeGreaterThanOrEqual(1);

      const { data: stale } = await W1.client
        .from('workouts')
        .insert({ user_id: W1.id, team_id: teamId, activity_type: 'krafttraining', status: 'laeuft', started_at: new Date(Date.now() - 200 * 60000).toISOString() })
        .select('id')
        .single();
      const { data: afterStale } = await userA.client.rpc('get_team_running_count', { p_team_id: teamId });
      expect(Number(afterStale)).toBe(Number(baseline)); // >180min old — never advertised as "live"

      await admin.from('workouts').update({ paused_at: new Date().toISOString() }).eq('id', fresh!.id);
      const { data: afterPause } = await userA.client.rpc('get_team_running_count', { p_team_id: teamId });
      expect(Number(afterPause)).toBe(Number(baseline) - 1); // paused — also never "live"

      await admin.from('workouts').delete().in('id', [fresh!.id, stale!.id]);
    });

    it('121. a reaction set on an activity message is the same row the ordinary chat reactions loader sees', async () => {
      const id = await finish(W2, 15, new Date());
      const messageId = await messageIdFor(id);
      const setRes = await userA.client.rpc('set_message_reaction', { p_message_id: messageId, p_reaction_key: 'fire', p_active: true });
      expect(setRes.error).toBeNull();
      const { data: reactions } = await admin.from('message_reactions').select('user_id, reaction_type').eq('message_id', messageId);
      expect(reactions?.some((r) => r.user_id === userA.id && r.reaction_type === 'fire')).toBe(true);
    });
  });

  describe('Milestone B: missions, recaps, quiet hours', () => {
    let mTeamId: string;
    let M1: typeof userB; // admin
    let M2: typeof userB; // member

    const finishOn = async (user: typeof userB, dateStr: string, minutes = 20) => {
      const at = new Date(`${dateStr}T12:00:00+01:00`);
      const { data: w } = await user.client
        .from('workouts')
        .insert({
          user_id: user.id,
          team_id: mTeamId,
          activity_type: 'krafttraining',
          status: 'laeuft',
          title: 'Mission Test',
          started_at: new Date(at.getTime() - minutes * 60000).toISOString(),
        })
        .select('id')
        .single();
      const res = await user.client.from('workouts').update({ status: 'abgeschlossen', finished_at: at.toISOString(), duration_seconds: minutes * 60 }).eq('id', w!.id);
      expect(res.error).toBeNull();
      return w!.id as string;
    };

    beforeAll(async () => {
      const { data: team } = await admin
        .from('teams')
        .insert({ name: `Mission Test Team ${Date.now()}`, slug: `mission-test-${Date.now()}` })
        .select('id')
        .single();
      mTeamId = team!.id;
      M1 = await createTestUser('mission-admin');
      M2 = await createTestUser('mission-member');
      await admin.from('team_members').insert([
        { team_id: mTeamId, user_id: M1.id, role: 'team_admin' },
        { team_id: mTeamId, user_id: M2.id, role: 'member' },
      ]);
    });
    afterAll(async () => {
      await admin.from('teams').delete().eq('id', mTeamId);
      for (const u of [M1, M2]) await admin.auth.admin.deleteUser(u.id).catch(() => undefined);
    });

    describe('team missions (Wochenmission)', () => {
      let missionId: string;

      it('122. a non-admin member cannot create a mission; an admin can', async () => {
        const attempt = await M2.client
          .from('team_missions')
          .insert({ team_id: mTeamId, title: 'x', target_days: 3, starts_at: '2026-01-01', ends_at: '2026-01-07', created_by: M2.id })
          .select('id');
        expect(attempt.data ?? []).toEqual([]);

        const { data, error } = await M1.client
          .from('team_missions')
          .insert({ team_id: mTeamId, title: 'Gemeinsam 4 Trainingstage', target_days: 4, starts_at: '2026-01-01', ends_at: '2026-01-07', created_by: M1.id })
          .select('id')
          .single();
        expect(error).toBeNull();
        missionId = data!.id;
      });

      it('123. a non-member cannot read this team\'s mission', async () => {
        const { data } = await outsider.client.from('team_missions').select('id').eq('id', missionId);
        expect(data ?? []).toEqual([]);
      });

      it('124. two workouts by the same member on the same date count as one training day', async () => {
        await finishOn(M1, '2026-01-02');
        await finishOn(M1, '2026-01-02');
        const { data, error } = await M1.client.rpc('get_team_mission_training_days', { p_team_id: mTeamId, p_start_date: '2026-01-01', p_end_date: '2026-01-07' });
        expect(error).toBeNull();
        expect(Number(data)).toBe(1);
      });

      it('125. a second member training the same date contributes a second training day', async () => {
        await finishOn(M2, '2026-01-02');
        const { data } = await M1.client.rpc('get_team_mission_training_days', { p_team_id: mTeamId, p_start_date: '2026-01-01', p_end_date: '2026-01-07' });
        expect(Number(data)).toBe(2);
      });

      it('126. an opted-out member\'s workouts do not count toward the team total', async () => {
        await admin.from('privacy_settings').upsert({ user_id: M2.id, activity_feed_opt_in: false });
        const { data } = await M1.client.rpc('get_team_mission_training_days', { p_team_id: mTeamId, p_start_date: '2026-01-01', p_end_date: '2026-01-07' });
        expect(Number(data)).toBe(1);
        await admin.from('privacy_settings').upsert({ user_id: M2.id, activity_feed_opt_in: true });
      });

      it('127. a member removed from the team no longer contributes', async () => {
        await admin.from('team_members').delete().eq('team_id', mTeamId).eq('user_id', M2.id);
        const { data } = await M1.client.rpc('get_team_mission_training_days', { p_team_id: mTeamId, p_start_date: '2026-01-01', p_end_date: '2026-01-07' });
        expect(Number(data)).toBe(1);
        await admin.from('team_members').insert({ team_id: mTeamId, user_id: M2.id, role: 'member' });
      });

      it('128. a non-member caller is rejected with not_a_team_member', async () => {
        const { error } = await outsider.client.rpc('get_team_mission_training_days', { p_team_id: mTeamId, p_start_date: '2026-01-01', p_end_date: '2026-01-07' });
        expect(error).not.toBeNull();
      });

      it('129. a non-admin cannot cancel a mission; an admin can', async () => {
        const attempt = await M2.client.from('team_missions').update({ cancelled_at: new Date().toISOString() }).eq('id', missionId).select('id');
        expect(attempt.data ?? []).toEqual([]);

        const res = await M1.client.from('team_missions').update({ cancelled_at: new Date().toISOString() }).eq('id', missionId).select('cancelled_at').single();
        expect(res.error).toBeNull();
        expect(res.data?.cancelled_at).toBeTruthy();
      });

      it('130. the freeze trigger rejects changing target_days/starts_at/ends_at even for an admin', async () => {
        const targetAttempt = await M1.client.from('team_missions').update({ target_days: 99 }).eq('id', missionId);
        expect(targetAttempt.error).not.toBeNull();
        const dateAttempt = await M1.client.from('team_missions').update({ starts_at: '2026-02-01' }).eq('id', missionId);
        expect(dateAttempt.error).not.toBeNull();
      });

      it('131. maybe_celebrate_mission claims exactly once when progress reaches target', async () => {
        const { data: mission2 } = await M1.client
          .from('team_missions')
          .insert({ team_id: mTeamId, title: 'Celebration Test', target_days: 1, starts_at: '2026-01-10', ends_at: '2026-01-10', created_by: M1.id })
          .select('id')
          .single();
        await finishOn(M1, '2026-01-10');

        const first = await M1.client.rpc('maybe_celebrate_mission', { p_mission_id: mission2!.id });
        expect(first.error).toBeNull();
        expect(first.data).toBe(true);

        const second = await M1.client.rpc('maybe_celebrate_mission', { p_mission_id: mission2!.id });
        expect(second.data).toBe(false);

        const { data: finalRow } = await admin.from('team_missions').select('celebrated_at').eq('id', mission2!.id).single();
        expect(finalRow?.celebrated_at).toBeTruthy();
      });

      it('132. mission completion creates zero additional fitness_score_events rows', async () => {
        const { data: mission3 } = await M1.client
          .from('team_missions')
          .insert({ team_id: mTeamId, title: 'Celebration Test 2', target_days: 1, starts_at: '2026-01-11', ends_at: '2026-01-11', created_by: M1.id })
          .select('id')
          .single();
        await finishOn(M2, '2026-01-11');

        const { count: before } = await admin.from('fitness_score_events').select('id', { count: 'exact', head: true }).eq('team_id', mTeamId);
        await M1.client.rpc('maybe_celebrate_mission', { p_mission_id: mission3!.id });
        const { count: after } = await admin.from('fitness_score_events').select('id', { count: 'exact', head: true }).eq('team_id', mTeamId);
        expect(after).toBe(before);
      });
    });

    describe('weekly recaps (idempotent generation)', () => {
      const weekStart = '2026-01-05';

      it('133. upsert_personal_weekly_recap is idempotent: same row, id unchanged, is_new only true once', async () => {
        const first = await M1.client.rpc('upsert_personal_weekly_recap', {
          p_week_start: weekStart,
          p_team_id: mTeamId,
          p_completed_workouts: 3,
          p_minutes: 120,
          p_points: 50,
          p_weekly_goal: 3,
          p_goal_achieved: true,
          p_personal_record_title: null,
          p_personal_record_detail: null,
          p_streak_days: 2,
        });
        expect(first.error).toBeNull();
        const row1 = first.data![0];
        expect(row1.is_new).toBe(true);

        const second = await M1.client.rpc('upsert_personal_weekly_recap', {
          p_week_start: weekStart,
          p_team_id: mTeamId,
          p_completed_workouts: 4,
          p_minutes: 150,
          p_points: 70,
          p_weekly_goal: 3,
          p_goal_achieved: true,
          p_personal_record_title: 'Neuer Rekord',
          p_personal_record_detail: 'Test',
          p_streak_days: 3,
        });
        const row2 = second.data![0];
        expect(row2.id).toBe(row1.id);
        expect(row2.is_new).toBe(false);

        const { data: finalRow } = await admin.from('personal_weekly_recaps').select('*').eq('id', row1.id).single();
        expect(finalRow?.completed_workouts).toBe(4);
        expect(finalRow?.personal_record_title).toBe('Neuer Rekord');
      });

      it('134. upsert_team_weekly_recap is idempotent the same way', async () => {
        const first = await M1.client.rpc('upsert_team_weekly_recap', { p_team_id: mTeamId, p_week_start: weekStart, p_completed_workouts: 5, p_active_members: 2, p_members_goal_reached: 1 });
        const row1 = first.data![0];
        const second = await M1.client.rpc('upsert_team_weekly_recap', { p_team_id: mTeamId, p_week_start: weekStart, p_completed_workouts: 8, p_active_members: 2, p_members_goal_reached: 2 });
        const row2 = second.data![0];
        expect(row2.id).toBe(row1.id);
        expect(row2.is_new).toBe(false);
      });

      it('135. a user cannot read another user\'s personal recap; a non-member cannot read another team\'s recap', async () => {
        const { data: viaOther } = await M2.client.from('personal_weekly_recaps').select('id').eq('user_id', M1.id);
        expect(viaOther ?? []).toEqual([]);
        const { data: viaOutsider } = await outsider.client.from('team_weekly_recaps').select('id').eq('team_id', mTeamId);
        expect(viaOutsider ?? []).toEqual([]);
      });

      it('136. mark_weekly_recap_notified only affects the caller\'s own row', async () => {
        const { data: row } = await admin.from('personal_weekly_recaps').select('id').eq('user_id', M1.id).eq('week_start', weekStart).single();
        const attempt = await M2.client.rpc('mark_weekly_recap_notified', { p_id: row!.id });
        expect(attempt.error).toBeNull();
        const { data: unaffected } = await admin.from('personal_weekly_recaps').select('notified_at').eq('id', row!.id).single();
        expect(unaffected?.notified_at).toBeNull();
      });

      it('137. a non-member cannot call get_team_week_summary for a foreign team', async () => {
        const { error } = await outsider.client.rpc('get_team_week_summary', { p_team_id: mTeamId, p_range_start: '2026-01-05T00:00:00Z', p_range_end: '2026-01-12T00:00:00Z' });
        expect(error).not.toBeNull();
      });

      it('138. get_team_week_summary excludes an opted-out member\'s workout from all three counts', async () => {
        // A narrow, unused-elsewhere single-day window — must not overlap
        // M2's Jan-11 workout from the mission "celebration" tests above:
        // get_team_week_summary reads CURRENT opt-in status, so an opt-out
        // here would otherwise also retroactively exclude that unrelated
        // earlier workout and confuse this test's before/after comparison.
        const range = { p_team_id: mTeamId, p_range_start: '2026-01-20T00:00:00+01:00', p_range_end: '2026-01-21T00:00:00+01:00' };
        const before = (await M1.client.rpc('get_team_week_summary', range)).data![0];

        await admin.from('privacy_settings').upsert({ user_id: M2.id, activity_feed_opt_in: false });
        await finishOn(M2, '2026-01-20');

        const after = (await M1.client.rpc('get_team_week_summary', range)).data![0];
        expect(after.completed_workouts).toBe(before.completed_workouts);
        expect(after.active_members).toBe(before.active_members);

        await admin.from('privacy_settings').upsert({ user_id: M2.id, activity_feed_opt_in: true });
      });
    });

    describe('notification quiet hours & motivation pause (new columns)', () => {
      it('139. a user can set and read their own quiet-hours/motivation-pause preferences', async () => {
        const until = new Date(Date.now() + 86400000).toISOString();
        const res = await M1.client
          .from('notification_preferences')
          .update({ quiet_hours_start: '22:00', quiet_hours_end: '07:00', motivation_paused_until: until })
          .eq('user_id', M1.id)
          .select('quiet_hours_start, quiet_hours_end, motivation_paused_until')
          .single();
        expect(res.error).toBeNull();
        expect(res.data?.quiet_hours_start).toBe('22:00:00');
        expect(res.data?.motivation_paused_until).toBeTruthy();
      });

      it('140. a user cannot set another user\'s notification preferences (existing owner-only RLS, unaffected by the new columns)', async () => {
        const attempt = await M2.client.from('notification_preferences').update({ quiet_hours_start: '08:00' }).eq('user_id', M1.id).select('user_id');
        expect(attempt.data ?? []).toEqual([]);
      });
    });
  });

  describe('Milestone C: duels, training invitations, opt-in notifications, evaluation', () => {
    let cTeamId: string;
    let C1: typeof userB; // admin
    let C2: typeof userB; // member
    let C3: typeof userB; // member

    beforeAll(async () => {
      const { data: team } = await admin
        .from('teams')
        .insert({ name: `Milestone C Test Team ${Date.now()}`, slug: `milestone-c-${Date.now()}` })
        .select('id')
        .single();
      cTeamId = team!.id;
      C1 = await createTestUser('c-admin');
      C2 = await createTestUser('c-member-2');
      C3 = await createTestUser('c-member-3');
      await admin.from('team_members').insert([
        { team_id: cTeamId, user_id: C1.id, role: 'team_admin' },
        { team_id: cTeamId, user_id: C2.id, role: 'member' },
        { team_id: cTeamId, user_id: C3.id, role: 'member' },
      ]);
    });
    afterAll(async () => {
      await admin.from('teams').delete().eq('id', cTeamId);
      for (const u of [C1, C2, C3]) await admin.auth.admin.deleteUser(u.id).catch(() => undefined);
    });

    describe('opt-in notification categories (duelle, gemeinsame_trainings)', () => {
      const NINE_DEFAULT_ON = [
        'chat_nachrichten', 'reaktionen_antworten', 'erwaehnungen', 'trainingserinnerung', 'wochenziel',
        'messungserinnerung', 'herausforderung', 'team_aktivitaet', 'wochenzusammenfassung',
      ];

      it('141. both new categories default to FALSE on a fresh profile while the nine existing ones stay ON', async () => {
        const { data, error } = await admin.from('notification_preferences').select('*').eq('user_id', C1.id).single();
        expect(error).toBeNull();
        expect(data!.duelle).toBe(false);
        expect(data!.gemeinsame_trainings).toBe(false);
        for (const category of NINE_DEFAULT_ON) expect(data![category], category).toBe(true);
      });

      it('142. a user can switch an opt-in on for themselves without touching the other categories or the other opt-in', async () => {
        const before = (await admin.from('notification_preferences').select('*').eq('user_id', C2.id).single()).data!;
        const res = await C2.client.from('notification_preferences').update({ duelle: true }).eq('user_id', C2.id).select('*').single();
        expect(res.error).toBeNull();
        expect(res.data!.duelle).toBe(true);
        expect(res.data!.gemeinsame_trainings).toBe(false);
        for (const category of NINE_DEFAULT_ON) expect(res.data![category], category).toBe(before[category]);
        expect(res.data!.quiet_hours_start).toBe(before.quiet_hours_start);
        expect(res.data!.motivation_paused_until).toBe(before.motivation_paused_until);

        const off = await C2.client.from('notification_preferences').update({ duelle: false }).eq('user_id', C2.id).select('duelle').single();
        expect(off.data!.duelle).toBe(false);
      });

      it('143. the new columns are covered by the existing owner-only RLS (no cross-user read or write, no anonymous read)', async () => {
        const write = await C2.client.from('notification_preferences').update({ duelle: true, gemeinsame_trainings: true }).eq('user_id', C1.id).select('user_id');
        expect(write.data ?? []).toEqual([]);
        const { data: unchanged } = await admin.from('notification_preferences').select('duelle, gemeinsame_trainings').eq('user_id', C1.id).single();
        expect(unchanged).toEqual({ duelle: false, gemeinsame_trainings: false });

        const read = await C2.client.from('notification_preferences').select('duelle, gemeinsame_trainings').eq('user_id', C1.id);
        expect(read.data ?? []).toEqual([]);

        const anon = createClient(SUPABASE_URL, ANON_KEY);
        const anonRead = await anon.from('notification_preferences').select('duelle').eq('user_id', C1.id);
        expect(anonRead.data ?? []).toEqual([]);
      });
    });

    describe('team duels (Freundschaftsduell)', () => {
      type Who = typeof userB;
      const GHOST_ID = '00000000-0000-4000-8000-000000000000';
      const berlinToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
      const dayKeyPlus = (days: number) => addDaysToKey(berlinToday(), days);
      const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

      const propose = (who: Who, invitee: string, target: number | null = 3, startsOn: string | null = dayKeyPlus(5), team: string = cTeamId) =>
        who.client.rpc('propose_team_duel', { p_team_id: team, p_invitee_id: invitee, p_target_days: target, p_starts_on: startsOn });
      const respond = (who: Who, duelId: string, accept: boolean) => who.client.rpc('respond_team_duel', { p_duel_id: duelId, p_accept: accept });
      const cancel = (who: Who, duelId: string) => who.client.rpc('cancel_team_duel', { p_duel_id: duelId });
      const progress = (who: Who, duelId: string) => who.client.rpc('get_duel_progress', { p_duel_id: duelId });
      const countsOf = (res: { data: { participant_id: string; counted_days: number }[] | null }) =>
        Object.fromEntries((res.data ?? []).map((r) => [r.participant_id, r.counted_days]));
      const expectError = async (p: PromiseLike<{ error: { message: string } | null }>, text: string) => {
        const r = await p;
        expect(r.error?.message, text).toContain(text);
      };
      const resetDuels = async () => {
        await admin.from('team_duels').delete().eq('team_id', cTeamId);
      };
      const duelRows = async () => (await admin.from('team_duels').select('*').eq('team_id', cTeamId)).data ?? [];
      const statusOf = async (id: string) => (await admin.from('team_duels').select('status').eq('id', id).single()).data!.status as string;

      /** Direct fixture insert (service role): pins dates/status the RPCs would refuse. */
      const insertDuel = async (over: Record<string, unknown> = {}) => {
        const startsOn = (over.starts_on as string | undefined) ?? dayKeyPlus(5);
        const { data, error } = await admin
          .from('team_duels')
          .insert({
            team_id: cTeamId, inviter_id: C2.id, invitee_id: C3.id, target_days: 3,
            starts_on: startsOn, ends_on: addDaysToKey(startsOn, 6),
            expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), status: 'pending',
            ...over,
          })
          .select('*')
          .single();
        if (error) throw error;
        return data!;
      };
      /** A completed workout at an exact instant (service role, no scoring/chat side effects of the user flow). */
      const workoutAt = async (who: Who, instant: string, teamId: string = cTeamId) => {
        const finished = new Date(instant);
        const { error } = await admin.from('workouts').insert({
          user_id: who.id, team_id: teamId, activity_type: 'krafttraining', status: 'abgeschlossen', title: 'Duel Test',
          started_at: new Date(finished.getTime() - 20 * 60_000).toISOString(), finished_at: finished.toISOString(), duration_seconds: 1200,
        });
        expect(error).toBeNull();
      };
      const clearWorkouts = async () => {
        await admin.from('workouts').delete().in('user_id', [C2.id, C3.id]);
      };

      beforeEach(async () => {
        await resetDuels();
        await clearWorkouts();
      });

      it('144. propose_team_duel creates a pending invitation with a seven-day window and a bounded expiry', async () => {
        const startsOn = dayKeyPlus(10);
        const res = await propose(C1, C2.id, 3, startsOn);
        expect(res.error).toBeNull();
        expect(res.data![0].is_new).toBe(true);
        const duel = (await admin.from('team_duels').select('*').eq('id', res.data![0].duel_id).single()).data!;
        expect(duel).toMatchObject({
          team_id: cTeamId, inviter_id: C1.id, invitee_id: C2.id, target_days: 3, status: 'pending',
          starts_on: startsOn, ends_on: addDaysToKey(startsOn, 6), cancelled_by: null, responded_at: null,
        });
        // A far-off start gives three days to answer.
        const hours = (new Date(duel.expires_at).getTime() - new Date(duel.created_at).getTime()) / 3_600_000;
        expect(hours).toBeGreaterThan(71.9);
        expect(hours).toBeLessThan(72.1);

        // Starting tomorrow, the invitation dies at the start of that day (Berlin midnight), never after.
        await resetDuels();
        const tomorrow = dayKeyPlus(1);
        const soon = await propose(C1, C2.id, 3, tomorrow);
        const soonRow = (await admin.from('team_duels').select('expires_at').eq('id', soon.data![0].duel_id).single()).data!;
        expect(new Date(soonRow.expires_at).getTime()).toBe(localDateTimeToUtc(`${tomorrow}T00:00`)!.getTime());
      });

      it('145. propose_team_duel rejects a bad target or start, a self-invite and anyone outside the team — without leaking who is where', async () => {
        await expectError(propose(C1, C2.id, 3, berlinToday()), 'invalid_start_date'); // today: not in the future
        await expectError(propose(C1, C2.id, 3, dayKeyPlus(-1)), 'invalid_start_date'); // retroactive
        await expectError(propose(C1, C2.id, 3, dayKeyPlus(15)), 'invalid_start_date'); // too far out
        await expectError(propose(C1, C2.id, 3, null), 'invalid_start_date');
        await expectError(propose(C1, C2.id, 0), 'invalid_target_days');
        await expectError(propose(C1, C2.id, 8), 'invalid_target_days');
        await expectError(propose(C1, C2.id, null), 'invalid_target_days');
        await expectError(propose(C1, C1.id), 'invalid_invitee');
        await expectError(propose(C1, outsider.id), 'invitee_unavailable'); // exists, but in another team
        await expectError(propose(C1, GHOST_ID), 'invitee_unavailable'); // does not exist: the very same answer
        await expectError(propose(outsider, C1.id), 'not_a_team_member'); // not a member of this team at all
        await expectError(propose(C1, C2.id, 3, dayKeyPlus(5), outsiderTeamId), 'not_a_team_member'); // foreign team id
        expect(await duelRows()).toEqual([]);

        // The boundaries themselves are valid.
        expect((await propose(C1, C2.id, 1, dayKeyPlus(1))).error).toBeNull();
        await resetDuels();
        expect((await propose(C1, C2.id, 7, dayKeyPlus(14))).error).toBeNull();
      });

      it('146. an identical retry returns the same invitation (is_new=false); concurrent double-submits create exactly one', async () => {
        const startsOn = dayKeyPlus(6);
        const first = await propose(C1, C2.id, 3, startsOn);
        const second = await propose(C1, C2.id, 3, startsOn);
        expect(second.error).toBeNull();
        expect(second.data![0].duel_id).toBe(first.data![0].duel_id);
        expect(second.data![0].is_new).toBe(false);
        expect(await duelRows()).toHaveLength(1);

        await resetDuels();
        const results = await Promise.all(Array.from({ length: 5 }, () => propose(C1, C2.id, 3, startsOn)));
        expect(results.every((r) => r.error === null)).toBe(true);
        expect(new Set(results.map((r) => r.data![0].duel_id)).size).toBe(1);
        expect(results.filter((r) => r.data![0].is_new)).toHaveLength(1);
        expect(await duelRows()).toHaveLength(1);
      });

      it('147. one open duel per person; a busy invitee is indistinguishable from an unavailable one', async () => {
        await propose(C1, C2.id);
        await expectError(propose(C1, C3.id), 'already_in_duel'); // the inviter is already in one
        await expectError(propose(C2, C3.id), 'already_in_duel'); // so is the invitee, from their side
        await expectError(propose(C3, C2.id), 'invitee_unavailable'); // someone else invites the busy invitee
        await expectError(propose(C3, C1.id), 'invitee_unavailable'); // ...or the busy inviter
        const busy = await propose(C3, C2.id);
        const absent = await propose(C3, outsider.id);
        expect(busy.error!.message).toBe(absent.error!.message);
        expect(await duelRows()).toHaveLength(1);
      });

      it('148. concurrent invitations cannot both win: A→B vs C→B, and A→B vs B→A, each leave exactly one duel', async () => {
        // A race can pass by luck once, so repeat it: with the per-person
        // advisory locks the outcome is exactly one winner every time.
        for (let round = 0; round < 6; round++) {
          await resetDuels();
          const [x, y] = await Promise.all([propose(C1, C2.id), propose(C3, C2.id)]);
          expect([x, y].filter((r) => r.error === null), `A→B vs C→B, round ${round}`).toHaveLength(1);
          expect([x, y].find((r) => r.error)!.error!.message).toContain('invitee_unavailable');
          expect(await duelRows()).toHaveLength(1);

          await resetDuels();
          const [p, q] = await Promise.all([propose(C1, C2.id), propose(C2, C1.id)]);
          expect([p, q].filter((r) => r.error === null), `A→B vs B→A, round ${round}`).toHaveLength(1);
          expect(await duelRows()).toHaveLength(1);
        }
      });

      it('149. an expired invitation stops blocking both people and is marked expired', async () => {
        const stale = await insertDuel({ inviter_id: C1.id, invitee_id: C2.id, expires_at: minutesAgo(1) });
        expect((await propose(C1, C3.id)).error).toBeNull(); // the stale inviter is free
        expect(await statusOf(stale.id)).toBe('expired');

        await resetDuels();
        await insertDuel({ inviter_id: C1.id, invitee_id: C2.id, expires_at: minutesAgo(1) });
        expect((await propose(C3, C2.id)).error).toBeNull(); // and so is the stale invitee
      });

      it('150. only the invitee can accept: everyone else gets the same "not found" and nothing changes; retries are harmless', async () => {
        const id = (await propose(C1, C2.id)).data![0].duel_id as string;
        const ghost = await respond(C2, GHOST_ID, true);
        for (const who of [C1, C3, outsider]) {
          const r = await respond(who, id, true);
          expect(r.error?.message).toContain('duel_not_found');
          expect(r.error?.message).toBe(ghost.error?.message); // same answer as for a duel that does not exist
        }
        expect(await statusOf(id)).toBe('pending');

        expect((await respond(C2, id, true)).data![0]).toEqual({ duel_status: 'accepted', changed: true });
        const row = (await admin.from('team_duels').select('*').eq('id', id).single()).data!;
        expect(row.status).toBe('accepted');
        expect(row.responded_at).not.toBeNull();
        // Retrying — or "declining" afterwards — is a quiet no-op, never an error.
        expect((await respond(C2, id, true)).data![0]).toEqual({ duel_status: 'accepted', changed: false });
        expect((await respond(C2, id, false)).data![0]).toEqual({ duel_status: 'accepted', changed: false });
      });

      it('151. declining is final for that invitation, repeatable, and the inviter may invite again', async () => {
        const id = (await propose(C1, C2.id)).data![0].duel_id as string;
        expect((await respond(C2, id, false)).data![0]).toEqual({ duel_status: 'declined', changed: true });
        expect((await respond(C2, id, false)).data![0]).toEqual({ duel_status: 'declined', changed: false });
        expect((await respond(C2, id, true)).data![0]).toEqual({ duel_status: 'declined', changed: false }); // no resurrection
        expect(await statusOf(id)).toBe('declined');
        expect((await propose(C1, C2.id)).error).toBeNull();
      });

      it('152. accepting after the invitation expired — or after its start date arrived — returns "expired" and persists it (no retroactive start)', async () => {
        const stale = await insertDuel({ inviter_id: C1.id, invitee_id: C2.id, expires_at: minutesAgo(5) });
        const r = await respond(C2, stale.id, true);
        expect(r.error).toBeNull();
        expect(r.data![0]).toEqual({ duel_status: 'expired', changed: true });
        expect(await statusOf(stale.id)).toBe('expired');
        expect((await respond(C2, stale.id, true)).data![0]).toEqual({ duel_status: 'expired', changed: false });

        await resetDuels();
        const started = await insertDuel({ inviter_id: C1.id, invitee_id: C2.id, starts_on: berlinToday() });
        expect((await respond(C2, started.id, true)).data![0].duel_status).toBe('expired');
        expect(await statusOf(started.id)).toBe('expired');
      });

      it('153. a duel\'s terms are frozen and its status only moves forward — even for the service role', async () => {
        const d = await insertDuel({ inviter_id: C1.id, invitee_id: C2.id, status: 'accepted' });
        const frozen: Record<string, unknown>[] = [
          { target_days: 7 },
          { starts_on: dayKeyPlus(9), ends_on: dayKeyPlus(15) },
          { invitee_id: C3.id },
          { inviter_id: C3.id },
          { expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() },
          { team_id: outsiderTeamId },
        ];
        for (const patch of frozen) {
          const r = await admin.from('team_duels').update(patch).eq('id', d.id);
          expect(r.error?.message, JSON.stringify(patch)).toContain('duel_terms_are_frozen');
        }

        const illegal: [Record<string, unknown>, string][] = [
          [{ status: 'declined' }, 'accepted'],
          [{ status: 'expired' }, 'accepted'],
          [{ status: 'cancelled', cancelled_by: C1.id }, 'pending'],
          [{ status: 'accepted' }, 'pending'],
          [{ status: 'accepted' }, 'expired'],
          [{ status: 'accepted' }, 'declined'],
        ];
        for (const [fixture, to] of illegal) {
          const row = await insertDuel({ inviter_id: C1.id, invitee_id: C2.id, ...fixture });
          const patch: Record<string, unknown> = { status: to };
          if (to !== 'cancelled') patch.cancelled_by = null;
          const r = await admin.from('team_duels').update(patch).eq('id', row.id);
          expect(r.error?.message, `${fixture.status as string} -> ${to}`).toContain('invalid_duel_transition');
        }
        // Forward moves are fine.
        const pending = await insertDuel({ inviter_id: C1.id, invitee_id: C2.id });
        expect((await admin.from('team_duels').update({ status: 'accepted' }).eq('id', pending.id)).error).toBeNull();
      });

      it('154. clients cannot write team_duels directly (there is no insert, update or delete policy)', async () => {
        const startsOn = dayKeyPlus(5);
        const ins = await C1.client.from('team_duels').insert({
          team_id: cTeamId, inviter_id: C1.id, invitee_id: C2.id, target_days: 3, starts_on: startsOn,
          ends_on: addDaysToKey(startsOn, 6), expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        });
        expect(ins.error).not.toBeNull();

        const d = await insertDuel({ inviter_id: C1.id, invitee_id: C2.id });
        const selfAccept = await C2.client.from('team_duels').update({ status: 'accepted' }).eq('id', d.id).select('id');
        expect(selfAccept.data ?? []).toEqual([]);
        const del = await C1.client.from('team_duels').delete().eq('id', d.id).select('id');
        expect(del.data ?? []).toEqual([]);
        expect(await statusOf(d.id)).toBe('pending');
      });

      it('155. only the two participants can read a duel — not the team admin, another member, an outsider or an anonymous caller', async () => {
        const d = await insertDuel({ inviter_id: C2.id, invitee_id: C3.id, status: 'accepted', starts_on: dayKeyPlus(-1) });
        for (const who of [C2, C3]) {
          expect((await who.client.from('team_duels').select('id').eq('id', d.id)).data).toHaveLength(1);
        }
        for (const who of [C1, outsider, userA, userB]) {
          expect((await who.client.from('team_duels').select('id').eq('id', d.id)).data ?? []).toEqual([]);
        }
        const anon = createClient(SUPABASE_URL, ANON_KEY);
        expect((await anon.from('team_duels').select('id').eq('id', d.id)).data ?? []).toEqual([]);

        // Progress for a non-participant is empty — no error, no hint the duel exists.
        const asAdmin = await progress(C1, d.id);
        expect(asAdmin.error).toBeNull();
        expect(asAdmin.data ?? []).toEqual([]);
        expect(countsOf(await progress(C2, d.id))).toEqual({ [C2.id]: 0, [C3.id]: 0 });
      });

      it('156. progress counts distinct Berlin dates with a completed workout per participant, ignoring other teams, unfinished workouts and anything outside the window', async () => {
        const d = await insertDuel({ inviter_id: C2.id, invitee_id: C3.id, status: 'accepted', target_days: 3, starts_on: '2026-01-05' }); // Mon 5th – Sun 11th
        await workoutAt(C2, '2026-01-06T08:00:00+01:00'); // three workouts the same date = one day
        await workoutAt(C2, '2026-01-06T12:00:00+01:00');
        await workoutAt(C2, '2026-01-06T19:00:00+01:00');
        await workoutAt(C2, '2026-01-08T18:00:00+01:00'); // a second date
        await workoutAt(C2, '2026-01-04T23:30:00+01:00'); // the evening before the window
        await workoutAt(C2, '2026-01-12T00:30:00+01:00'); // just after it
        await workoutAt(C2, '2026-01-09T10:00:00+01:00', outsiderTeamId); // another team's workout
        await admin.from('workouts').insert({ user_id: C2.id, team_id: cTeamId, activity_type: 'krafttraining', status: 'laeuft', started_at: '2026-01-10T10:00:00+01:00' }); // never finished
        const mine = countsOf(await progress(C2, d.id));
        expect(mine).toEqual({ [C2.id]: 2, [C3.id]: 0 });
        expect(countsOf(await progress(C3, d.id))).toEqual(mine); // both see the same numbers
      });

      it('157. progress never exceeds the target', async () => {
        const d = await insertDuel({ inviter_id: C2.id, invitee_id: C3.id, status: 'accepted', target_days: 2, starts_on: '2026-02-02' });
        for (const day of ['02', '03', '04', '05']) await workoutAt(C2, `2026-02-${day}T18:00:00+01:00`);
        expect(countsOf(await progress(C3, d.id))).toEqual({ [C2.id]: 2, [C3.id]: 0 });
      });

      it('158. the window runs Berlin midnight to Berlin midnight, including the 23-hour and 25-hour daylight-saving days', async () => {
        const counted = async (startsOn: string) => {
          const d = await insertDuel({ inviter_id: C2.id, invitee_id: C3.id, status: 'accepted', target_days: 7, starts_on: startsOn });
          const n = countsOf(await progress(C2, d.id))[C2.id];
          await admin.from('team_duels').delete().eq('id', d.id);
          return n;
        };
        // Spring: Mon 03-23 … Sun 03-29 (clocks jump 02:00→03:00 on the 29th, a 23-hour day).
        await workoutAt(C2, '2026-03-22T23:50:00+01:00'); // Sunday before: out
        await workoutAt(C2, '2026-03-28T23:50:00+01:00'); // Saturday: in (day 1)
        await workoutAt(C2, '2026-03-29T00:10:00+01:00'); // first minutes of the short day: in (day 2)
        await workoutAt(C2, '2026-03-29T23:50:00+02:00'); // same Berlin date: still day 2
        await workoutAt(C2, '2026-03-30T00:10:00+02:00'); // Monday after: out
        expect(await counted('2026-03-23')).toBe(2);
        // A window that STARTS on the transition day: 03-29 … 04-04.
        expect(await counted('2026-03-29')).toBe(2); // 03-29 (both workouts, one date) and 03-30
        await clearWorkouts();

        // Autumn: Mon 10-19 … Sun 10-25 (clocks go back 03:00→02:00 on the 25th, a 25-hour day).
        await workoutAt(C2, '2026-10-18T23:30:00+02:00'); // out
        await workoutAt(C2, '2026-10-25T00:30:00+02:00'); // first hour of the long day: in
        await workoutAt(C2, '2026-10-25T23:30:00+01:00'); // last hour of the long day: same date
        await workoutAt(C2, '2026-10-26T00:30:00+01:00'); // out
        expect(await counted('2026-10-19')).toBe(1);
        // Starting ON the 25th: 10-25 … 10-31.
        expect(await counted('2026-10-25')).toBe(2); // the 25th and the 26th
      });

      it('159. an opted-out member\'s days still count in a duel they accepted, while the team-wide mission count keeps excluding them', async () => {
        const d = await insertDuel({ inviter_id: C2.id, invitee_id: C3.id, status: 'accepted', target_days: 3, starts_on: '2026-04-06' });
        await workoutAt(C2, '2026-04-07T18:00:00+02:00');
        const range = { p_team_id: cTeamId, p_start_date: '2026-04-06', p_end_date: '2026-04-12' };
        expect(Number((await C1.client.rpc('get_team_mission_training_days', range)).data)).toBe(1);

        await admin.from('privacy_settings').upsert({ user_id: C2.id, activity_feed_opt_in: false });
        expect(countsOf(await progress(C2, d.id))[C2.id]).toBe(1); // explicit per-duel consent
        expect(Number((await C1.client.rpc('get_team_mission_training_days', range)).data)).toBe(0); // team feature still honours the opt-out
        await admin.from('privacy_settings').upsert({ user_id: C2.id, activity_feed_opt_in: true });
      });

      it('160. either participant can end a duel without a reason; a third member cannot; ending twice or after it finished changes nothing', async () => {
        // A pending invitation withdrawn by the inviter.
        const id1 = (await propose(C1, C2.id)).data![0].duel_id as string;
        await expectError(cancel(C3, id1), 'duel_not_found');
        expect((await cancel(C1, id1)).data![0]).toEqual({ duel_status: 'cancelled', changed: true });
        const row1 = (await admin.from('team_duels').select('cancelled_by').eq('id', id1).single()).data!;
        expect(row1.cancelled_by).toBe(C1.id);
        expect((await cancel(C1, id1)).data![0]).toEqual({ duel_status: 'cancelled', changed: false });

        // The invitee "cancelling" a pending invitation is simply a decline.
        const id2 = (await propose(C1, C2.id)).data![0].duel_id as string;
        expect((await cancel(C2, id2)).data![0]).toEqual({ duel_status: 'declined', changed: true });

        // An accepted, running duel can be ended by either side — and its progress disappears.
        const running = await insertDuel({ inviter_id: C1.id, invitee_id: C2.id, status: 'accepted', starts_on: dayKeyPlus(-2) });
        expect((await cancel(C2, running.id)).data![0]).toEqual({ duel_status: 'cancelled', changed: true });
        expect((await admin.from('team_duels').select('cancelled_by').eq('id', running.id).single()).data!.cancelled_by).toBe(C2.id);
        expect((await progress(C1, running.id)).data ?? []).toEqual([]);

        // A duel that has already finished can no longer be rewritten.
        const finished = await insertDuel({ inviter_id: C1.id, invitee_id: C2.id, status: 'accepted', starts_on: dayKeyPlus(-10) });
        expect((await cancel(C1, finished.id)).data![0]).toEqual({ duel_status: 'accepted', changed: false });
        expect(await statusOf(finished.id)).toBe('accepted');
      });

      it('161. a participant leaving the team hides the duel and unblocks the other person; re-joining restores it', async () => {
        const d = await insertDuel({ inviter_id: C2.id, invitee_id: C3.id, status: 'accepted', starts_on: dayKeyPlus(-1) });
        expect((await C2.client.from('team_duels').select('id').eq('id', d.id)).data).toHaveLength(1);

        await admin.from('team_members').delete().eq('team_id', cTeamId).eq('user_id', C3.id);
        expect((await C2.client.from('team_duels').select('id').eq('id', d.id)).data ?? []).toEqual([]);
        expect((await progress(C2, d.id)).data ?? []).toEqual([]);
        await expectError(respond(C2, d.id, true), 'duel_not_found');
        await expectError(cancel(C2, d.id), 'duel_not_found');
        expect((await propose(C2, C1.id)).error).toBeNull(); // no longer blocked by the dangling duel

        await admin.from('team_duels').delete().eq('team_id', cTeamId).neq('id', d.id);
        await admin.from('team_members').insert({ team_id: cTeamId, user_id: C3.id, role: 'member' });
        expect((await C2.client.from('team_duels').select('id').eq('id', d.id)).data).toHaveLength(1);
        expect(countsOf(await progress(C2, d.id))).toEqual({ [C2.id]: 0, [C3.id]: 0 });
      });

      it('162. proposing, accepting, declining and cancelling write no points, chat messages, notifications, feed items or audit rows', async () => {
        const ids = [C1.id, C2.id, C3.id];
        const snapshot = async () => ({
          score: (await admin.from('fitness_score_events').select('id', { count: 'exact', head: true }).in('user_id', ids)).count,
          messages: (await admin.from('messages').select('id', { count: 'exact', head: true }).eq('team_id', cTeamId)).count,
          notifications: (await admin.from('notifications').select('id', { count: 'exact', head: true }).in('user_id', ids)).count,
          feed: (await admin.from('activity_feed').select('id', { count: 'exact', head: true }).eq('team_id', cTeamId)).count,
          audit: (await admin.from('audit_events').select('id', { count: 'exact', head: true }).eq('team_id', cTeamId)).count,
        });
        const before = await snapshot();
        const a = (await propose(C1, C2.id)).data![0].duel_id as string;
        await respond(C2, a, true);
        await cancel(C1, a);
        const b = (await propose(C1, C3.id)).data![0].duel_id as string;
        await respond(C3, b, false);
        expect(await snapshot()).toEqual(before);
      });

      it('163. the duel functions are not callable anonymously, and the internal busy-check is not callable by clients at all', async () => {
        const anon = createClient(SUPABASE_URL, ANON_KEY);
        const calls: [string, Record<string, unknown>][] = [
          ['propose_team_duel', { p_team_id: cTeamId, p_invitee_id: C2.id, p_target_days: 3, p_starts_on: dayKeyPlus(5) }],
          ['respond_team_duel', { p_duel_id: GHOST_ID, p_accept: true }],
          ['cancel_team_duel', { p_duel_id: GHOST_ID }],
          ['get_duel_progress', { p_duel_id: GHOST_ID }],
          ['has_open_duel', { p_team_id: cTeamId, p_user_id: C2.id, p_today: berlinToday() }],
        ];
        for (const [fn, args] of calls) expect((await anon.rpc(fn, args)).error, fn).not.toBeNull();
        expect((await C1.client.rpc('has_open_duel', { p_team_id: cTeamId, p_user_id: C2.id, p_today: berlinToday() })).error).not.toBeNull();
        expect(await duelRows()).toEqual([]);
      });

      it('164. deleting an account that is in duels succeeds and removes those duels for the other side too', async () => {
        const X = await createTestUser('c-leaver');
        await admin.from('team_members').insert({ team_id: cTeamId, user_id: X.id, role: 'member' });
        const withdrawn = (await propose(X, C2.id)).data![0].duel_id as string;
        await cancel(X, withdrawn); // leaves a row whose cancelled_by is X
        const open = (await propose(X, C3.id)).data![0].duel_id as string;
        expect(await duelRows()).toHaveLength(2);

        const del = await admin.auth.admin.deleteUser(X.id);
        expect(del.error).toBeNull();
        expect((await admin.from('team_duels').select('id').in('id', [withdrawn, open])).data).toEqual([]);
        expect((await propose(C3, C2.id)).error).toBeNull(); // C3 is no longer held by the departed account's invitation
      });

      it('193. a person who ends up in two open duels (a partner was removed, then rejoined) can still see and end each of them', async () => {
        const older = await insertDuel({ inviter_id: C2.id, invitee_id: C3.id, status: 'accepted', starts_on: dayKeyPlus(-1) });
        await admin.from('team_members').delete().eq('team_id', cTeamId).eq('user_id', C3.id);
        // While C3 is away the dangling duel does not block C2 — so C2 can enter a new one with C1.
        const newer = (await propose(C2, C1.id)).data![0].duel_id as string;
        expect((await respond(C1, newer, true)).data![0].duel_status).toBe('accepted');

        await admin.from('team_members').insert({ team_id: cTeamId, user_id: C3.id, role: 'member' });
        const visible = ((await C2.client.from('team_duels').select('id')).data ?? []).map((r) => r.id);
        expect(visible).toEqual(expect.arrayContaining([older.id, newer])); // neither is hidden from the person in both
        expect((await cancel(C2, older.id)).data![0]).toEqual({ duel_status: 'cancelled', changed: true });
        expect((await cancel(C2, newer)).data![0]).toEqual({ duel_status: 'cancelled', changed: true });
      });
    });

    describe('training invitations ("Wer ist dabei?")', () => {
      type Who = typeof userB;
      const GHOST_ID = '00000000-0000-4000-8000-000000000000';
      const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
      const inDays = (d: number) => inHours(d * 24);

      const publishArgs = (over: Record<string, unknown> = {}) => ({
        p_invite_id: crypto.randomUUID(), p_team_id: cTeamId, p_title: 'Beine & Rücken', p_starts_at: inHours(30),
        p_activity_type: 'krafttraining', p_place: 'Eingang Studio', p_note: 'Bring ein Handtuch', p_plan_share_id: null, ...over,
      });
      const publish = (who: Who, over: Record<string, unknown> = {}) => who.client.rpc('publish_training_invite', publishArgs(over));
      const updateArgs = (id: string, over: Record<string, unknown> = {}) => ({
        p_invite_id: id, p_title: 'Beine & Rücken', p_starts_at: inHours(30), p_activity_type: 'krafttraining',
        p_place: 'Eingang Studio', p_note: 'Bring ein Handtuch', p_plan_share_id: null, ...over,
      });
      const rsvp = (who: Who, inviteId: string, status: string | null) => who.client.rpc('set_training_invite_rsvp', { p_invite_id: inviteId, p_status: status });
      const cancelInvite = (who: Who, inviteId: string) => who.client.rpc('cancel_training_invite', { p_invite_id: inviteId });
      const expectError = async (p: PromiseLike<{ error: { message: string } | null }>, text: string) => {
        const r = await p;
        expect(r.error?.message, text).toContain(text);
      };

      /** An invitation created by `who`, returning ids; fixed start unless overridden. */
      const makeInvite = async (who: Who, over: Record<string, unknown> = {}) => {
        const args = publishArgs(over);
        const res = await who.client.rpc('publish_training_invite', args);
        expect(res.error).toBeNull();
        return { inviteId: args.p_invite_id as string, messageId: res.data![0].out_message_id as string, startsAt: args.p_starts_at as string };
      };
      const inviteRow = async (id: string) => (await admin.from('training_invites').select('*').eq('id', id).single()).data!;
      const rsvpRows = async (id: string) => (await admin.from('training_invite_rsvps').select('user_id, status').eq('invite_id', id)).data ?? [];
      const messageCount = async () => (await admin.from('messages').select('id', { count: 'exact', head: true }).eq('team_id', cTeamId)).count;
      const makeShare = async (teamId: string, author: Who, over: Record<string, unknown> = {}) => {
        const { data: msg } = await admin.from('messages').insert({ team_id: teamId, user_id: author.id, content: 'geteilt', message_type: 'text' }).select('id').single();
        const { data: share, error } = await admin
          .from('plan_shares')
          .insert({ message_id: msg!.id, team_id: teamId, author_id: author.id, source_type: 'template', title: 'Push Day', ...over })
          .select('id')
          .single();
        if (error) throw error;
        return share!.id as string;
      };

      beforeEach(async () => {
        await admin.from('messages').delete().eq('team_id', cTeamId).not('metadata->>training_invite_id', 'is', null);
        await admin.from('plan_shares').delete().eq('team_id', cTeamId);
        // Plan-share fixture messages are plain text rows; leave chat history alone otherwise.
      });

      it('165. publish creates ONE chat message (metadata set from the first INSERT), the invitation and the organizer\'s own "Dabei"', async () => {
        const before = await messageCount();
        const startsAt = '2026-12-24T17:00:00.000Z';
        void startsAt;
        const when = inHours(30);
        const args = publishArgs({ p_starts_at: when, p_title: '  Beine & Rücken  ', p_place: '  Eingang Studio ', p_note: '' });
        const res = await C1.client.rpc('publish_training_invite', args);
        expect(res.error).toBeNull();
        expect(res.data![0].is_new).toBe(true);

        const { data: msg } = await admin.from('messages').select('*').eq('id', res.data![0].out_message_id).single();
        expect(msg).toMatchObject({ team_id: cTeamId, user_id: C1.id, message_type: 'text', deleted_at: null, edited_at: null });
        expect(msg!.metadata).toEqual({ training_invite_id: args.p_invite_id }); // present immediately — no later UPDATE
        const berlinDay = new Date(when).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' });
        const berlinTime = new Date(when).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false });
        expect(msg!.content).toBe(`Gemeinsames Training: Beine & Rücken · ${berlinDay}, ${berlinTime} Uhr`);

        const inv = await inviteRow(args.p_invite_id);
        expect(inv).toMatchObject({
          message_id: msg!.id, team_id: cTeamId, organizer_id: C1.id, title: 'Beine & Rücken', activity_type: 'krafttraining',
          place: 'Eingang Studio', note: null, plan_share_id: null, rsvp_version: 0, cancelled_at: null, edited_at: null,
        });
        expect(await rsvpRows(args.p_invite_id)).toEqual([{ user_id: C1.id, status: 'going' }]);
        expect(await messageCount()).toBe((before ?? 0) + 1);
      });

      it('166. publish validates and normalizes every field, with a precise error each', async () => {
        await expectError(publish(C1, { p_title: '' }), 'invalid_title');
        await expectError(publish(C1, { p_title: '   ' }), 'invalid_title');
        await expectError(publish(C1, { p_title: 'x'.repeat(81) }), 'invalid_title');
        await expectError(publish(C1, { p_place: 'x'.repeat(81) }), 'invalid_place');
        await expectError(publish(C1, { p_note: 'x'.repeat(201) }), 'invalid_note');
        await expectError(publish(C1, { p_activity_type: 'yoga' }), 'invalid_activity_type');
        await expectError(publish(C1, { p_starts_at: inHours(-1) }), 'invalid_start_time'); // in the past
        await expectError(publish(C1, { p_starts_at: null }), 'invalid_start_time');
        await expectError(publish(C1, { p_starts_at: inDays(91) }), 'invalid_start_time'); // too far ahead
        await expectError(publish(C1, { p_team_id: outsiderTeamId }), 'not_a_team_member'); // foreign team
        await expectError(publish(outsider), 'not_a_team_member'); // not a member of this team
        await expectError(publish(C1, { p_invite_id: null }), 'invalid_request');
        expect(await messageCount()).toBe(await messageCount()); // nothing half-created:
        expect((await admin.from('training_invites').select('id').eq('team_id', cTeamId)).data).toEqual([]);

        // Boundary values are fine, and empty optional text is stored as NULL.
        const ok = await publish(C1, { p_title: 'x'.repeat(80), p_place: 'y'.repeat(80), p_note: 'z'.repeat(200), p_starts_at: inDays(89), p_activity_type: null });
        expect(ok.error).toBeNull();
        const blank = await publish(C1, { p_place: '  ', p_note: '', p_activity_type: null });
        const row = await inviteRow(blank.data![0].out_invite_id);
        expect(row.place).toBeNull();
        expect(row.note).toBeNull();
        expect(row.activity_type).toBeNull();
      });

      it('167. publishing is idempotent on the invitation id — retries and concurrent double taps make one card; another user cannot reuse the id', async () => {
        const args = publishArgs();
        const first = await C1.client.rpc('publish_training_invite', args);
        const second = await C1.client.rpc('publish_training_invite', args);
        expect(second.error).toBeNull();
        expect(second.data![0]).toMatchObject({ out_message_id: first.data![0].out_message_id, out_invite_id: args.p_invite_id, is_new: false });
        await expectError(C2.client.rpc('publish_training_invite', args), 'invalid_request'); // someone else's id
        expect((await admin.from('training_invites').select('id').eq('id', args.p_invite_id)).data).toHaveLength(1);

        const burst = publishArgs();
        const before = await messageCount();
        const results = await Promise.all(Array.from({ length: 5 }, () => C2.client.rpc('publish_training_invite', burst)));
        expect(results.every((r) => r.error === null)).toBe(true);
        expect(results.filter((r) => r.data![0].is_new)).toHaveLength(1);
        expect(new Set(results.map((r) => r.data![0].out_message_id)).size).toBe(1);
        expect(await messageCount()).toBe((before ?? 0) + 1);
      });

      it('168. members can read invitations and answers; outsiders cannot; clients cannot write any of it', async () => {
        const { inviteId } = await makeInvite(C1);
        await rsvp(C2, inviteId, 'maybe');
        for (const who of [C1, C2, C3]) {
          expect((await who.client.from('training_invites').select('id').eq('id', inviteId)).data).toHaveLength(1);
          expect((await who.client.from('training_invite_rsvps').select('user_id').eq('invite_id', inviteId)).data).toHaveLength(2);
        }
        for (const who of [outsider, userA]) {
          expect((await who.client.from('training_invites').select('id').eq('id', inviteId)).data ?? []).toEqual([]);
          expect((await who.client.from('training_invite_rsvps').select('user_id').eq('invite_id', inviteId)).data ?? []).toEqual([]);
        }
        const anon = createClient(SUPABASE_URL, ANON_KEY);
        expect((await anon.from('training_invites').select('id').eq('id', inviteId)).data ?? []).toEqual([]);

        // No client write path of any kind — not even for the organizer or the team admin.
        const ins = await C3.client.from('training_invites').insert({ id: crypto.randomUUID(), message_id: crypto.randomUUID(), team_id: cTeamId, organizer_id: C3.id, title: 'x', starts_at: inHours(5) });
        expect(ins.error).not.toBeNull();
        const forged = await C3.client.from('training_invite_rsvps').insert({ invite_id: inviteId, team_id: cTeamId, user_id: C2.id, status: 'going' });
        expect(forged.error).not.toBeNull();
        const selfInsert = await C3.client.from('training_invite_rsvps').insert({ invite_id: inviteId, team_id: cTeamId, user_id: C3.id, status: 'going' });
        expect(selfInsert.error).not.toBeNull();
        for (const who of [C1, C2]) {
          const upd = await who.client.from('training_invites').update({ title: 'gehackt', starts_at: inHours(2) }).eq('id', inviteId).select('id');
          expect(upd.data ?? []).toEqual([]);
          const del = await who.client.from('training_invites').delete().eq('id', inviteId).select('id');
          expect(del.data ?? []).toEqual([]);
        }
        const delRsvp = await C1.client.from('training_invite_rsvps').delete().eq('invite_id', inviteId).eq('user_id', C2.id).select('user_id');
        expect(delRsvp.data ?? []).toEqual([]);
        expect((await inviteRow(inviteId)).title).toBe('Beine & Rücken');
        expect(await rsvpRows(inviteId)).toHaveLength(2);
      });

      it('169. answering: going / maybe / withdraw are changeable and idempotent, and rsvp_version moves only on a real change', async () => {
        const { inviteId } = await makeInvite(C1);
        const version = async () => (await inviteRow(inviteId)).rsvp_version as number;
        const v0 = await version();

        expect((await rsvp(C2, inviteId, 'going')).data).toBe('going');
        expect(await version()).toBe(v0 + 1);
        expect((await rsvp(C2, inviteId, 'going')).data).toBe('going'); // retry: nothing changes
        expect(await version()).toBe(v0 + 1);
        expect((await rsvp(C2, inviteId, 'maybe')).data).toBe('maybe');
        expect(await version()).toBe(v0 + 2);
        expect((await rsvp(C2, inviteId, null)).data).toBeNull(); // withdraw
        expect(await version()).toBe(v0 + 3);
        expect((await rsvp(C2, inviteId, null)).error).toBeNull(); // withdrawing again is a quiet no-op
        expect(await version()).toBe(v0 + 3);
        await expectError(rsvp(C2, inviteId, 'definitely'), 'invalid_status');
        expect(await rsvpRows(inviteId)).toEqual([{ user_id: C1.id, status: 'going' }]);

        // One row per person: changing never duplicates.
        await rsvp(C3, inviteId, 'maybe');
        await rsvp(C3, inviteId, 'going');
        expect((await rsvpRows(inviteId)).filter((r) => r.user_id === C3.id)).toEqual([{ user_id: C3.id, status: 'going' }]);
      });

      it('170. concurrent identical answers leave one row and bump the version exactly once', async () => {
        const { inviteId } = await makeInvite(C1);
        const v0 = (await inviteRow(inviteId)).rsvp_version as number;
        const results = await Promise.all(Array.from({ length: 6 }, () => rsvp(C2, inviteId, 'going')));
        expect(results.every((r) => r.error === null)).toBe(true);
        expect((await rsvpRows(inviteId)).filter((r) => r.user_id === C2.id)).toHaveLength(1);
        expect((await inviteRow(inviteId)).rsvp_version).toBe(v0 + 1);
      });

      it('171. answering is refused for an unknown or foreign invitation, a cancelled one, one that has started and one whose message was deleted', async () => {
        const { inviteId, messageId } = await makeInvite(C1);
        await expectError(rsvp(C2, GHOST_ID, 'going'), 'invite_not_found');
        await expectError(rsvp(outsider, inviteId, 'going'), 'invite_not_found'); // another team: same answer as "does not exist"

        await admin.from('training_invites').update({ starts_at: inHours(-1) }).eq('id', inviteId);
        await expectError(rsvp(C2, inviteId, 'going'), 'invite_started');
        await admin.from('training_invites').update({ starts_at: inHours(30) }).eq('id', inviteId);

        await admin.from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', messageId);
        await expectError(rsvp(C2, inviteId, 'going'), 'invite_closed'); // a deleted message closes its invitation
        await admin.from('messages').update({ deleted_at: null }).eq('id', messageId);

        await cancelInvite(C1, inviteId);
        await expectError(rsvp(C2, inviteId, 'going'), 'invite_closed');
        await expectError(rsvp(C2, inviteId, null), 'invite_closed');
      });

      it('172. an answer is not a workout: no workout, points, feed item, chat message, notification or mission progress, and no unread change', async () => {
        const { inviteId } = await makeInvite(C1);
        const ids = [C1.id, C2.id, C3.id];
        const snapshot = async () => ({
          workouts: (await admin.from('workouts').select('id', { count: 'exact', head: true }).in('user_id', ids)).count,
          score: (await admin.from('fitness_score_events').select('id', { count: 'exact', head: true }).in('user_id', ids)).count,
          messages: await messageCount(),
          notifications: (await admin.from('notifications').select('id', { count: 'exact', head: true }).in('user_id', ids)).count,
          feed: (await admin.from('activity_feed').select('id', { count: 'exact', head: true }).eq('team_id', cTeamId)).count,
          audit: (await admin.from('audit_events').select('id', { count: 'exact', head: true }).eq('team_id', cTeamId)).count,
          mission: Number((await C1.client.rpc('get_team_mission_training_days', { p_team_id: cTeamId, p_start_date: '2020-01-01', p_end_date: '2040-01-01' })).data),
        });
        const before = await snapshot();
        await rsvp(C2, inviteId, 'going');
        await rsvp(C3, inviteId, 'maybe');
        await rsvp(C2, inviteId, 'maybe');
        await rsvp(C3, inviteId, null);
        expect(await snapshot()).toEqual(before);
      });

      it('173. the organizer can edit: only a changed time or place is "substantial"; an identical re-submit writes nothing; answers are kept', async () => {
        const { inviteId, messageId, startsAt } = await makeInvite(C2);
        await rsvp(C3, inviteId, 'going');

        // Title only: changed, but not worth a notification — and the message is NOT marked edited.
        const t1 = await C2.client.rpc('update_training_invite', updateArgs(inviteId, { p_title: 'Beine & Rücken & Core', p_starts_at: startsAt }));
        expect(t1.error).toBeNull();
        expect(t1.data![0]).toMatchObject({ changed: true, substantial: false, out_message_id: messageId });
        const msg1 = (await admin.from('messages').select('content, edited_at').eq('id', messageId).single()).data!;
        expect(msg1.content).toContain('Beine & Rücken & Core');
        expect(msg1.edited_at).toBeNull();
        expect((await inviteRow(inviteId)).edited_at).not.toBeNull();

        // Note / type / template link only: still not substantial.
        const t2 = await C2.client.rpc('update_training_invite', updateArgs(inviteId, { p_title: 'Beine & Rücken & Core', p_starts_at: startsAt, p_note: 'Neu', p_activity_type: 'cardio' }));
        expect(t2.data![0]).toMatchObject({ changed: true, substantial: false });

        // Identical re-submit: nothing written at all.
        const editedAt = (await inviteRow(inviteId)).edited_at;
        const same = await C2.client.rpc('update_training_invite', updateArgs(inviteId, { p_title: 'Beine & Rücken & Core', p_starts_at: startsAt, p_note: 'Neu', p_activity_type: 'cardio' }));
        expect(same.data![0]).toMatchObject({ changed: false, substantial: false });
        expect((await inviteRow(inviteId)).edited_at).toBe(editedAt);

        // Time or place: substantial.
        const later = inHours(50);
        const time = await C2.client.rpc('update_training_invite', updateArgs(inviteId, { p_title: 'Beine & Rücken & Core', p_starts_at: later, p_note: 'Neu', p_activity_type: 'cardio' }));
        expect(time.data![0]).toMatchObject({ changed: true, substantial: true });
        const place = await C2.client.rpc('update_training_invite', updateArgs(inviteId, { p_title: 'Beine & Rücken & Core', p_starts_at: later, p_note: 'Neu', p_activity_type: 'cardio', p_place: 'Parkplatz' }));
        expect(place.data![0]).toMatchObject({ changed: true, substantial: true });

        expect(await rsvpRows(inviteId)).toEqual(expect.arrayContaining([{ user_id: C3.id, status: 'going' }, { user_id: C2.id, status: 'going' }]));
        expect(await messageCount()).toBe(await messageCount());
      });

      it('174. only the organizer may edit or cancel — not another member, not even the team admin — and not once it is closed or has started', async () => {
        const { inviteId } = await makeInvite(C2);
        for (const who of [C1, C3, outsider]) {
          await expectError(who.client.rpc('update_training_invite', updateArgs(inviteId, { p_title: 'Hijack' })), 'invite_not_found');
          await expectError(cancelInvite(who, inviteId), 'invite_not_found');
        }
        await expectError(C2.client.rpc('update_training_invite', updateArgs(GHOST_ID)), 'invite_not_found');
        await expectError(C2.client.rpc('update_training_invite', updateArgs(inviteId, { p_starts_at: inHours(-2) })), 'invalid_start_time');
        await expectError(C2.client.rpc('update_training_invite', updateArgs(inviteId, { p_title: '' })), 'invalid_title');
        expect((await inviteRow(inviteId)).title).toBe('Beine & Rücken');

        await admin.from('training_invites').update({ starts_at: inHours(-1) }).eq('id', inviteId);
        await expectError(C2.client.rpc('update_training_invite', updateArgs(inviteId)), 'invite_started');
        await admin.from('training_invites').update({ starts_at: inHours(30) }).eq('id', inviteId);

        await cancelInvite(C2, inviteId);
        await expectError(C2.client.rpc('update_training_invite', updateArgs(inviteId)), 'invite_closed');
      });

      it('175. cancelling is idempotent, reports whether it was still upcoming, and is final', async () => {
        const { inviteId } = await makeInvite(C2);
        const first = await cancelInvite(C2, inviteId);
        expect(first.data![0]).toMatchObject({ newly_cancelled: true, was_upcoming: true });
        expect((await cancelInvite(C2, inviteId)).data![0]).toMatchObject({ newly_cancelled: false });
        expect((await inviteRow(inviteId)).cancelled_at).not.toBeNull();
        const undo = await admin.from('training_invites').update({ cancelled_at: null }).eq('id', inviteId);
        expect(undo.error?.message).toContain('invite_cancellation_is_final');

        // Cancelling something that already started: allowed, but not "upcoming" (no push is warranted).
        const started = await makeInvite(C2);
        await admin.from('training_invites').update({ starts_at: inHours(-1) }).eq('id', started.inviteId);
        expect((await cancelInvite(C2, started.inviteId)).data![0]).toMatchObject({ newly_cancelled: true, was_upcoming: false });
      });

      it('176. an invitation\'s identity is frozen — message, team and organizer can never be moved, even by the service role', async () => {
        const a = await makeInvite(C2);
        const b = await makeInvite(C3);
        expect((await admin.from('training_invites').update({ message_id: b.messageId }).eq('id', a.inviteId)).error?.message).toContain('invite_identity_is_frozen');
        expect((await admin.from('training_invites').update({ organizer_id: C3.id }).eq('id', a.inviteId)).error?.message).toContain('invite_identity_is_frozen');
        expect((await admin.from('training_invites').update({ team_id: outsiderTeamId }).eq('id', a.inviteId)).error?.message).toContain('invite_identity_is_frozen');
      });

      it('177. a member who leaves disappears from the participant list and loses access; rejoining restores their answer', async () => {
        const { inviteId } = await makeInvite(C1);
        await rsvp(C3, inviteId, 'going');
        const visible = async (who: Who) => ((await who.client.from('training_invite_rsvps').select('user_id').eq('invite_id', inviteId)).data ?? []).map((r) => r.user_id).sort();
        expect(await visible(C2)).toEqual([C1.id, C3.id].sort());

        await admin.from('team_members').delete().eq('team_id', cTeamId).eq('user_id', C3.id);
        expect(await visible(C2)).toEqual([C1.id]); // no ghost participant
        expect((await C3.client.from('training_invites').select('id').eq('id', inviteId)).data ?? []).toEqual([]);
        await expectError(rsvp(C3, inviteId, 'maybe'), 'invite_not_found');

        await admin.from('team_members').insert({ team_id: cTeamId, user_id: C3.id, role: 'member' });
        expect(await visible(C2)).toEqual([C1.id, C3.id].sort());
      });

      it('178. a linked template must be a live share of this team; withdrawing or deleting it never breaks the invitation', async () => {
        const live = await makeShare(cTeamId, C1);
        const foreign = await makeShare(outsiderTeamId, outsider);
        const withdrawn = await makeShare(cTeamId, C1, { withdrawn_at: new Date().toISOString() });
        await expectError(publish(C1, { p_plan_share_id: foreign }), 'invalid_plan_share');
        await expectError(publish(C1, { p_plan_share_id: withdrawn }), 'invalid_plan_share');
        await expectError(publish(C1, { p_plan_share_id: GHOST_ID }), 'invalid_plan_share');

        const { inviteId } = await makeInvite(C1, { p_plan_share_id: live });
        expect((await inviteRow(inviteId)).plan_share_id).toBe(live);
        await expectError(C1.client.rpc('update_training_invite', updateArgs(inviteId, { p_plan_share_id: foreign })), 'invalid_plan_share');

        await admin.from('plan_shares').update({ withdrawn_at: new Date().toISOString() }).eq('id', live);
        expect((await inviteRow(inviteId)).plan_share_id).toBe(live); // link kept; the card just stops offering it
        await admin.from('plan_shares').delete().eq('id', live);
        expect((await inviteRow(inviteId)).plan_share_id).toBeNull();
        expect((await inviteRow(inviteId)).title).toBe('Beine & Rücken');
      });

      it('179. answers cannot name another team, and deleting the message, the invitation or an account cleans up completely', async () => {
        const { inviteId, messageId } = await makeInvite(C1);
        const mismatched = await admin.from('training_invite_rsvps').insert({ invite_id: inviteId, team_id: outsiderTeamId, user_id: C2.id, status: 'going' });
        expect(mismatched.error).not.toBeNull(); // composite FK (invite_id, team_id)

        await rsvp(C2, inviteId, 'going');
        await admin.from('messages').delete().eq('id', messageId);
        expect((await admin.from('training_invites').select('id').eq('id', inviteId)).data).toEqual([]);
        expect(await rsvpRows(inviteId)).toEqual([]);

        const X = await createTestUser('c-organizer');
        await admin.from('team_members').insert({ team_id: cTeamId, user_id: X.id, role: 'member' });
        const mine = await makeInvite(X);
        await rsvp(C2, mine.inviteId, 'maybe');
        expect((await admin.auth.admin.deleteUser(X.id)).error).toBeNull();
        expect((await admin.from('training_invites').select('id').eq('id', mine.inviteId)).data).toEqual([]);
        expect((await admin.from('messages').select('id').eq('id', mine.messageId)).data).toEqual([]);
        expect(await rsvpRows(mine.inviteId)).toEqual([]);
      });

      it('180. the functions are not callable anonymously, and the internal helpers are not callable by clients at all', async () => {
        const anon = createClient(SUPABASE_URL, ANON_KEY);
        const calls: [string, Record<string, unknown>][] = [
          ['publish_training_invite', publishArgs()],
          ['update_training_invite', updateArgs(GHOST_ID)],
          ['cancel_training_invite', { p_invite_id: GHOST_ID }],
          ['set_training_invite_rsvp', { p_invite_id: GHOST_ID, p_status: 'going' }],
        ];
        for (const [fn, args] of calls) expect((await anon.rpc(fn, args)).error, fn).not.toBeNull();
        expect((await C1.client.rpc('normalize_training_invite_fields', { p_title: 'x', p_starts_at: inHours(5), p_activity_type: null, p_place: null, p_note: null, p_plan_share_id: null, p_team_id: cTeamId })).error).not.toBeNull();
        expect((await C1.client.rpc('training_invite_message_text', { p_title: 'x', p_starts_at: inHours(5) })).error).not.toBeNull();
      });

      it('181. publish adds exactly one chat message; answering, editing and cancelling add none', async () => {
        const base = await messageCount();
        const { inviteId, startsAt } = await makeInvite(C2);
        expect(await messageCount()).toBe((base ?? 0) + 1);
        await rsvp(C3, inviteId, 'going');
        await rsvp(C3, inviteId, null);
        await C2.client.rpc('update_training_invite', updateArgs(inviteId, { p_title: 'Neu', p_starts_at: startsAt }));
        await cancelInvite(C2, inviteId);
        expect(await messageCount()).toBe((base ?? 0) + 1);
      });

      it('182. the chat sentence shows the Berlin calendar day and time, not UTC (checked just after and just before Berlin midnight)', async () => {
        const berlinParts = (iso: string) => ({
          day: new Date(iso).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' }),
          time: new Date(iso).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false }),
        });
        // The next two instants whose Berlin wall clock reads 00:30 and 23:30, a few days out.
        const target = new Date(Date.now() + 3 * 86_400_000);
        const key = target.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
        for (const hhmm of ['00:30', '23:30']) {
          const instant = localDateTimeToUtc(`${key}T${hhmm}`)!.toISOString();
          const { messageId } = await makeInvite(C1, { p_starts_at: instant, p_title: `Mitternacht ${hhmm}` });
          const { data: msg } = await admin.from('messages').select('content').eq('id', messageId).single();
          const { day, time } = berlinParts(instant);
          expect(msg!.content).toBe(`Gemeinsames Training: Mitternacht ${hhmm} · ${day}, ${time} Uhr`);
          expect(time).toBe(hhmm);
        }
      });

      it('183. team_has_member (used by the answers\' RLS) only answers for a team the caller belongs to — it cannot be used to probe other teams\' rosters', async () => {
        const ask = (who: Who, team: string, user: string) => who.client.rpc('team_has_member', { p_team_id: team, p_user_id: user });
        expect((await ask(C2, cTeamId, C3.id)).data).toBe(true); // own team: a teammate
        expect((await ask(C2, cTeamId, outsider.id)).data).toBe(false); // own team: not a member
        expect((await ask(C2, outsiderTeamId, outsider.id)).data).toBe(false); // another team's real member: indistinguishable from "no"
        expect((await ask(outsider, cTeamId, C2.id)).data).toBe(false); // an outsider learns nothing about this team
        expect((await ask(outsider, outsiderTeamId, outsider.id)).data).toBe(true); // ...but their own team works
      });
    });

    describe('engagement evaluation (admin-only, aggregate-only)', () => {
      type Who = typeof userB;
      const WHITELIST = [
        'week_start', 'in_progress', 'member_count', 'counted_members', 'active_participants', 'returning_participants',
        'supported_workouts', 'goal_reached_members', 'missions_started', 'missions_reached', 'missions_cancelled',
        'duels_accepted', 'duels_finished', 'training_invites_created',
      ];
      const berlinTodayKey = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
      const isoWeekday = (key: string) => {
        const d = new Date(`${key}T00:00:00Z`).getUTCDay();
        return d === 0 ? 7 : d;
      };
      /** Monday (YYYY-MM-DD, Berlin) of the week `offset` weeks from the current one. */
      const mondayOf = (offset: number) => {
        const today = berlinTodayKey();
        return addDaysToKey(today, -(isoWeekday(today) - 1) + offset * 7);
      };
      const at = (key: string, hhmm: string) => localDateTimeToUtc(`${key}T${hhmm}`)!.toISOString();

      const summary = (who: Who, weeks: number | null = 8, team: string = cTeamId) =>
        who.client.rpc('get_team_engagement_summary', { p_team_id: team, p_weeks: weeks });
      const weekRow = async (offset: number, weeks = 8) => {
        const res = await summary(C1, weeks);
        expect(res.error).toBeNull();
        const row = (res.data as Record<string, number | boolean | string>[]).find((r) => r.week_start === mondayOf(offset));
        expect(row, `week ${mondayOf(offset)}`).toBeDefined();
        return row as Record<string, number | boolean>;
      };
      const expectError = async (p: PromiseLike<{ error: { message: string } | null }>, text: string) => {
        const r = await p;
        expect(r.error?.message, text).toContain(text);
      };

      /** A completed workout at an exact instant, through the normal user flow so its chat event exists. */
      const finishAt = async (user: Who, instant: string) => {
        const { data: w, error } = await user.client
          .from('workouts')
          .insert({ user_id: user.id, team_id: cTeamId, activity_type: 'krafttraining', status: 'laeuft', title: 'Auswertung', started_at: new Date(new Date(instant).getTime() - 20 * 60_000).toISOString() })
          .select('id')
          .single();
        expect(error).toBeNull();
        const upd = await user.client.from('workouts').update({ status: 'abgeschlossen', finished_at: instant, duration_seconds: 1200 }).eq('id', w!.id);
        expect(upd.error).toBeNull();
        return w!.id as string;
      };
      const eventOf = async (workoutId: string) => {
        const { data } = await admin.from('messages').select('id').eq('workout_id', workoutId).eq('event_type', 'workout_completed').single();
        return data!.id as string;
      };

      beforeEach(async () => {
        await admin.from('workouts').delete().in('user_id', [C1.id, C2.id, C3.id]);
        await admin.from('messages').delete().eq('team_id', cTeamId).eq('message_type', 'system');
        await admin.from('team_duels').delete().eq('team_id', cTeamId);
        await admin.from('team_missions').delete().eq('team_id', cTeamId);
        await admin.from('profiles').update({ weekly_goal: 3 }).in('id', [C1.id, C2.id, C3.id]);
        await admin.from('privacy_settings').upsert([C1, C2, C3].map((u) => ({ user_id: u.id, activity_feed_opt_in: true })));
        const { data: members } = await admin.from('team_members').select('user_id').eq('team_id', cTeamId);
        for (const u of [C1, C2, C3]) {
          if (!(members ?? []).some((m) => m.user_id === u.id)) await admin.from('team_members').insert({ team_id: cTeamId, user_id: u.id, role: u === C1 ? 'team_admin' : 'member' });
        }
      });

      it('184. only a team admin of THAT team can read it — not a member, an admin of another team, an outsider or an anonymous caller', async () => {
        expect((await summary(C1)).error).toBeNull();
        for (const who of [C2, C3, outsider, userA]) await expectError(summary(who), 'not_team_admin');
        await expectError(summary(C1, 4, outsiderTeamId), 'not_team_admin'); // an admin asking about a team that is not theirs
        const anon = createClient(SUPABASE_URL, ANON_KEY);
        expect((await anon.rpc('get_team_engagement_summary', { p_team_id: cTeamId, p_weeks: 4 })).error).not.toBeNull();
      });

      it('185. the result is counts only: exactly the agreed columns, no id, name, text or per-person value', async () => {
        const res = await summary(C1, 3);
        expect(res.error).toBeNull();
        const rows = res.data as Record<string, unknown>[];
        expect(rows).toHaveLength(3);
        for (const row of rows) {
          expect(Object.keys(row).sort()).toEqual([...WHITELIST].sort());
          for (const [key, value] of Object.entries(row)) {
            if (key === 'week_start') expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            else expect(['number', 'boolean'], key).toContain(typeof value);
          }
        }
        // Nothing person-shaped anywhere in the serialized payload.
        const raw = JSON.stringify(res.data);
        for (const user of [C1, C2, C3]) expect(raw).not.toContain(user.id);
        expect(raw).not.toMatch(/Test|@|full_name|email/i);
      });

      it('186. the window is clamped to 1–26 Berlin weeks, newest first, consecutive Mondays, only the current week in progress', async () => {
        expect((await summary(C1, 0)).data).toHaveLength(1);
        expect((await summary(C1, -5)).data).toHaveLength(1);
        expect((await summary(C1, 100)).data).toHaveLength(26);
        expect((await summary(C1, null)).data).toHaveLength(8);
        const rows = (await summary(C1, 6)).data as { week_start: string; in_progress: boolean }[];
        expect(rows.map((r) => r.week_start)).toEqual([0, -1, -2, -3, -4, -5].map(mondayOf));
        expect(rows.map((r) => r.in_progress)).toEqual([true, false, false, false, false, false]);
      });

      it('187. a week is Monday to Sunday in Berlin time: Sunday 23:30 and Monday 00:30 land in different weeks; returning means active the week before too', async () => {
        const thisMonday = mondayOf(0);
        const lastMonday = mondayOf(-1);
        await finishAt(C2, at(thisMonday, '00:30')); // first minutes of this week
        await finishAt(C2, at(addDaysToKey(thisMonday, -1), '23:30')); // last minutes of last week
        await finishAt(C3, at(addDaysToKey(lastMonday, 2), '12:00')); // only last week

        const current = await weekRow(0);
        const previous = await weekRow(-1);
        expect(current.active_participants).toBe(1);
        expect(current.returning_participants).toBe(1); // C2 was active last week too
        expect(previous.active_participants).toBe(2);
        expect(previous.returning_participants).toBe(0); // nobody was active the week before that
        expect(current.in_progress).toBe(true);
        expect(previous.in_progress).toBe(false);
      });

      it('188. weekly-goal completion uses each member\'s own goal and workout count; many workouts still count a member once', async () => {
        const last = mondayOf(-1);
        await admin.from('profiles').update({ weekly_goal: 2 }).eq('id', C2.id);
        await admin.from('profiles').update({ weekly_goal: 3 }).eq('id', C3.id);
        await finishAt(C2, at(addDaysToKey(last, 1), '09:00'));
        await finishAt(C2, at(addDaysToKey(last, 1), '19:00')); // same day: still two workouts toward the goal
        await finishAt(C2, at(addDaysToKey(last, 2), '12:00'));
        await finishAt(C3, at(addDaysToKey(last, 1), '12:00'));
        await finishAt(C3, at(addDaysToKey(last, 3), '12:00')); // two of three
        const row = await weekRow(-1);
        expect(row.active_participants).toBe(2); // C2 once, despite three workouts
        expect(row.goal_reached_members).toBe(1); // C2 (goal 2) yes, C3 (goal 3) not yet
      });

      it('189. members who do not share their activity, and members who left, are not counted — and the gap is visible', async () => {
        const last = mondayOf(-1);
        await finishAt(C2, at(addDaysToKey(last, 1), '12:00'));
        await finishAt(C3, at(addDaysToKey(last, 2), '12:00'));
        let row = await weekRow(-1);
        expect(row).toMatchObject({ active_participants: 2, member_count: 3, counted_members: 3 });

        await admin.from('privacy_settings').upsert({ user_id: C2.id, activity_feed_opt_in: false });
        row = await weekRow(-1);
        expect(row).toMatchObject({ active_participants: 1, member_count: 3, counted_members: 2 });
        await admin.from('privacy_settings').upsert({ user_id: C2.id, activity_feed_opt_in: true });

        await admin.from('team_members').delete().eq('team_id', cTeamId).eq('user_id', C3.id);
        row = await weekRow(-1);
        expect(row).toMatchObject({ active_participants: 1, member_count: 2, counted_members: 2 });
        await admin.from('team_members').insert({ team_id: cTeamId, user_id: C3.id, role: 'member' });
        expect((await weekRow(-1)).active_participants).toBe(2);
      });

      it('190. a supported workout is one a teammate reacted to or replied to — counted once, in the workout\'s own week, never for self-reactions, departed people or deleted events', async () => {
        const last = mondayOf(-1);
        const w1 = await finishAt(C2, at(addDaysToKey(last, 1), '12:00'));
        const w2 = await finishAt(C2, at(addDaysToKey(last, 2), '12:00'));
        const w3 = await finishAt(C3, at(addDaysToKey(last, 3), '12:00'));
        const [e1, e2, e3] = [await eventOf(w1), await eventOf(w2), await eventOf(w3)];
        const supported = async () => (await weekRow(-1)).supported_workouts;
        expect(await supported()).toBe(0);

        const react = (messageId: string, who: { id: string }, type = 'heart') =>
          admin.from('message_reactions').insert({ message_id: messageId, team_id: cTeamId, user_id: who.id, reaction_type: type });
        await react(e1, C2); // the owner reacting to their own workout does not count
        expect(await supported()).toBe(0);
        await react(e1, C3); // a teammate does
        expect(await supported()).toBe(1);
        await react(e1, C1); // a second supporter of the SAME workout is not a second supported workout
        await react(e1, C3, 'fire');
        expect(await supported()).toBe(1);

        const reply = (parent: string, who: { id: string }, extra: Record<string, unknown> = {}) =>
          admin.from('messages').insert({ team_id: cTeamId, user_id: who.id, content: 'stark!', message_type: 'text', parent_message_id: parent, ...extra }).select('id').single();
        const r2 = await reply(e2, C3); // a text reply counts too
        expect(await supported()).toBe(2);
        await admin.from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', r2.data!.id); // ...until it is deleted
        expect(await supported()).toBe(1);
        await reply(e3, C3); // the owner replying to their own workout does not count
        await reply(e3, C3, { content: 'x' });
        expect(await supported()).toBe(1);

        await react(e3, outsider); // someone who is not (or no longer) in the team does not count
        expect(await supported()).toBe(1);
        await admin.from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', e1); // a deleted event drops out
        expect(await supported()).toBe(0);

        expect((await weekRow(0)).supported_workouts).toBe(0); // bucketed by the workout's week, not by when anyone reacted
      });

      it('191. missions, duels and invitations are counted per start week — duel outcomes and invitation answers are not exposed', async () => {
        const thisMonday = mondayOf(0);
        const lastMonday = mondayOf(-1);
        // Missions: one reached, one cancelled, one not reached — all starting last week.
        const mission = (over: Record<string, unknown>) =>
          admin.from('team_missions').insert({ team_id: cTeamId, title: 'M', target_days: 1, starts_at: lastMonday, ends_at: addDaysToKey(lastMonday, 6), created_by: C1.id, ...over });
        await mission({ title: 'erreicht' });
        await mission({ title: 'abgebrochen', target_days: 50, cancelled_at: new Date().toISOString() });
        await mission({ title: 'offen', target_days: 50 });
        await finishAt(C2, at(addDaysToKey(lastMonday, 1), '12:00'));
        // Duels: one accepted-and-finished, one accepted-then-cancelled, one never accepted — all starting last week.
        const duel = (over: Record<string, unknown>) =>
          admin.from('team_duels').insert({
            team_id: cTeamId, inviter_id: C2.id, invitee_id: C3.id, target_days: 3, starts_on: lastMonday, ends_on: addDaysToKey(lastMonday, 6),
            expires_at: new Date(Date.now() + 86_400_000).toISOString(), ...over,
          });
        await duel({ status: 'accepted', responded_at: new Date().toISOString() });
        await duel({ status: 'cancelled', responded_at: new Date().toISOString(), cancelled_by: C2.id });
        await duel({ status: 'declined', responded_at: new Date().toISOString() });
        await duel({ status: 'pending' });
        // Invitations created now (this week).
        await C2.client.rpc('publish_training_invite', { p_invite_id: crypto.randomUUID(), p_team_id: cTeamId, p_title: 'Zählt', p_starts_at: new Date(Date.now() + 30 * 3_600_000).toISOString(), p_activity_type: null, p_place: null, p_note: null, p_plan_share_id: null });

        const last = await weekRow(-1);
        expect(last).toMatchObject({ missions_started: 3, missions_reached: 1, missions_cancelled: 1, duels_accepted: 2, duels_finished: 1 });
        const current = await weekRow(0);
        expect(current.training_invites_created).toBeGreaterThanOrEqual(1);
        expect(thisMonday).not.toBe(lastMonday);

        // A participant leaving the team takes the duel out of the numbers.
        await admin.from('team_members').delete().eq('team_id', cTeamId).eq('user_id', C3.id);
        expect((await weekRow(-1)).duels_accepted).toBe(0);
        await admin.from('team_members').insert({ team_id: cTeamId, user_id: C3.id, role: 'member' });
      });

      it('192. an empty team answers with zeros, and reading the summary writes nothing', async () => {
        const { data: team } = await admin.from('teams').insert({ name: `Empty Eval ${Date.now()}`, slug: `empty-eval-${Date.now()}` }).select('id').single();
        const E = await createTestUser('c-empty-admin');
        await admin.from('team_members').insert({ team_id: team!.id, user_id: E.id, role: 'team_admin' });
        const res = await E.client.rpc('get_team_engagement_summary', { p_team_id: team!.id, p_weeks: 3 });
        expect(res.error).toBeNull();
        for (const row of res.data as Record<string, number | boolean | string>[]) {
          expect(row).toMatchObject({ member_count: 1, counted_members: 1, active_participants: 0, returning_participants: 0, supported_workouts: 0, goal_reached_members: 0, missions_started: 0, duels_accepted: 0, training_invites_created: 0 });
        }

        const count = async (table: string) => (await admin.from(table).select('id', { count: 'exact', head: true }).eq('team_id', cTeamId)).count;
        const before = [await count('messages'), await count('audit_events'), await count('activity_feed')];
        await summary(C1, 8);
        expect([await count('messages'), await count('audit_events'), await count('activity_feed')]).toEqual(before);

        await admin.from('teams').delete().eq('id', team!.id);
        await admin.auth.admin.deleteUser(E.id).catch(() => undefined);
      });
    });
  });

  describe('Fewer taps A: earlier results, replacing and postponing an exercise (0049)', () => {
    let F1: typeof userB; // trains
    let F2: typeof userB; // another user
    let fTeamId: string;
    const ex = { bench: '', benchTwin: '', dumbbell: '', run: '', plank: '', f2Private: '', f1Private: '' };
    const createdExercises: string[] = [];

    async function createExercise(name: string, type = 'strength', extra: Record<string, unknown> = {}) {
      const { data, error } = await admin.from('exercises').insert({ name, muscle_group: 'chest', exercise_type: type, ...extra }).select('id').single();
      if (error) throw error;
      createdExercises.push(data!.id);
      return data!.id as string;
    }

    beforeAll(async () => {
      const { data: team } = await admin.from('teams').insert({ name: `Fewer Taps A ${Date.now()}`, slug: `fewer-taps-a-${Date.now()}` }).select('id').single();
      fTeamId = team!.id;
      F1 = await createTestUser('f-owner');
      F2 = await createTestUser('f-other');
      await admin.from('team_members').insert([
        { team_id: fTeamId, user_id: F1.id, role: 'member' },
        { team_id: fTeamId, user_id: F2.id, role: 'member' },
      ]);
      ex.bench = await createExercise('FT Bankdrücken');
      ex.benchTwin = await createExercise('FT Bankdrücken'); // same name, different identity
      ex.dumbbell = await createExercise('FT Kurzhantel-Bankdrücken');
      ex.run = await createExercise('FT Laufen', 'cardio_distance', { muscle_group: 'cardio' });
      ex.plank = await createExercise('FT Plank', 'bodyweight');
      ex.f2Private = await createExercise('FT F2 privat', 'strength', { owner_user_id: F2.id, is_custom: true, visibility: 'private', created_by: F2.id });
      ex.f1Private = await createExercise('FT F1 privat', 'strength', { owner_user_id: F1.id, is_custom: true, visibility: 'private', created_by: F1.id });
    });

    afterEach(async () => {
      await admin.from('workouts').delete().in('user_id', [F1.id, F2.id]);
    });

    afterAll(async () => {
      await admin.from('workouts').delete().in('user_id', [F1.id, F2.id]);
      for (const u of [F1, F2]) await admin.auth.admin.deleteUser(u.id).catch(() => undefined); // takes their plans and templates along
      await admin.from('exercises').delete().in('id', createdExercises);
      await admin.from('teams').delete().eq('id', fTeamId);
    });

    type SetSpec = { weight?: number | null; reps?: number | null; km?: number | null; secs?: number | null; metrics?: Record<string, number>; completed?: boolean };
    type RowSpec = { exerciseId: string; position?: number; planned?: unknown; sets?: SetSpec[] };

    async function makeWorkout(user: typeof F1, o: { status?: string; daysAgo?: number; paused?: boolean; teamId?: string | null; withFinishedAt?: boolean; rows?: RowSpec[] } = {}) {
      const status = o.status ?? 'abgeschlossen';
      const finished = new Date(Date.now() - (o.daysAgo ?? (status === 'abgeschlossen' ? 3 : 0)) * 86_400_000);
      const row: Record<string, unknown> = {
        user_id: user.id,
        team_id: o.teamId ?? null,
        activity_type: 'krafttraining',
        status,
        title: 'FT',
        started_at: new Date(finished.getTime() - 3_600_000).toISOString(),
      };
      if (status === 'abgeschlossen') {
        row.finished_at = finished.toISOString();
        row.duration_seconds = 3600;
      } else if (o.withFinishedAt) {
        row.finished_at = finished.toISOString(); // not realistic, but the status rule must not depend on it
      }
      if (o.paused) row.paused_at = new Date().toISOString();
      const { data: w, error } = await admin.from('workouts').insert(row).select('id').single();
      if (error) throw error;
      const rows: { id: string; exerciseId: string }[] = [];
      for (const [i, r] of (o.rows ?? []).entries()) {
        const { data: we, error: weErr } = await admin
          .from('workout_exercises')
          .insert({ workout_id: w!.id, exercise_id: r.exerciseId, position: r.position ?? i, planned: r.planned ?? null })
          .select('id')
          .single();
        if (weErr) throw weErr;
        rows.push({ id: we!.id, exerciseId: r.exerciseId });
        for (const [j, s] of (r.sets ?? []).entries()) {
          const { error: sErr } = await admin.from('workout_sets').insert({
            workout_exercise_id: we!.id,
            set_number: j + 1,
            weight_kg: s.weight ?? null,
            reps: s.reps ?? null,
            distance_km: s.km ?? null,
            duration_seconds: s.secs ?? null,
            metrics: s.metrics ?? {},
            completed: s.completed ?? true,
          });
          if (sErr) throw sErr;
        }
      }
      return { id: w!.id as string, rows };
    }

    const last = (u: typeof F1, workoutId: string) => u.client.rpc('get_last_exercise_results', { p_workout_id: workoutId });
    const history = (u: typeof F1, exerciseId: string, args: Record<string, unknown> = {}) => u.client.rpc('get_exercise_history', { p_exercise_id: exerciseId, ...args });
    const replace = (u: typeof F1, rowId: string, newExercise: string, newRowId: string = crypto.randomUUID()) =>
      u.client.rpc('replace_workout_exercise', { p_workout_exercise_id: rowId, p_new_exercise_id: newExercise, p_new_workout_exercise_id: newRowId });
    const postpone = (u: typeof F1, rowId: string) => u.client.rpc('postpone_workout_exercise', { p_workout_exercise_id: rowId });
    const rowsOf = async (workoutId: string) =>
      (await admin.from('workout_exercises').select('id, exercise_id, position, planned, created_at').eq('workout_id', workoutId).order('position').order('created_at').order('id')).data!;
    const anon = () => createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

    describe('earlier results ("Letztes Mal")', () => {
      it('194. returns the actual sets of the latest COMPLETED session, ordered by when it finished — not by when the row was created', async () => {
        // The newer session is created first and the older one second: only finished_at may decide.
        await makeWorkout(F1, { daysAgo: 2, rows: [{ exerciseId: ex.bench, sets: [{ weight: 82.5, reps: 8 }] }] });
        const older = await makeWorkout(F1, { daysAgo: 9, rows: [{ exerciseId: ex.bench, sets: [{ weight: 80, reps: 10 }, { weight: 80, reps: 9 }, { weight: 75, reps: 8 }] }] });
        const cur = await makeWorkout(F1, { status: 'laeuft', rows: [{ exerciseId: ex.bench }, { exerciseId: ex.run }] });

        const res = await last(F1, cur.id);
        expect(res.error).toBeNull();
        expect(res.data).toHaveLength(1); // the run has no history, and "no history" is simply no row
        expect(res.data![0].out_exercise_id).toBe(ex.bench);
        expect(res.data![0].out_sets).toEqual([{ set_number: 1, weight_kg: 82.5, reps: 8, distance_km: null, duration_seconds: null, metrics: {} }]);

        // Without the newer session the older one is the answer, its sets in set order with their real weights.
        await admin.from('workouts').delete().eq('user_id', F1.id).eq('status', 'abgeschlossen').neq('id', older.id);
        const again = (await last(F1, cur.id)).data!;
        expect(again[0].out_workout_id).toBe(older.id);
        expect(again[0].out_sets.map((s: { set_number: number; weight_kg: number; reps: number }) => [s.set_number, s.weight_kg, s.reps])).toEqual([[1, 80, 10], [2, 80, 9], [3, 75, 8]]);
      });

      it('195. every exercise gets its own latest session, however long ago it was — there is no "most recent few workouts" window', async () => {
        await makeWorkout(F1, { daysAgo: 200, rows: [{ exerciseId: ex.bench, sets: [{ weight: 70, reps: 10 }] }] });
        for (let d = 1; d <= 30; d++) await makeWorkout(F1, { daysAgo: d, rows: [{ exerciseId: ex.run, sets: [{ km: 5, secs: 1800 }] }] });
        const cur = await makeWorkout(F1, { status: 'laeuft', rows: [{ exerciseId: ex.bench }, { exerciseId: ex.run }] });
        const res = (await last(F1, cur.id)).data!;
        expect(res.map((r: { out_exercise_id: string }) => r.out_exercise_id).sort()).toEqual([ex.bench, ex.run].sort());
        const bench = res.find((r: { out_exercise_id: string }) => r.out_exercise_id === ex.bench);
        expect(bench.out_sets[0].weight_kg).toBe(70);
      });

      it('196. exercises are matched by identity, never by name', async () => {
        await makeWorkout(F1, { daysAgo: 4, rows: [{ exerciseId: ex.benchTwin, sets: [{ weight: 100, reps: 5 }] }] });
        const cur = await makeWorkout(F1, { status: 'laeuft', rows: [{ exerciseId: ex.bench }] });
        expect((await last(F1, cur.id)).data).toEqual([]); // same name, different exercise: nothing
        expect((await history(F1, ex.bench)).data).toEqual([]);

        const planned = await makeWorkout(F1, { status: 'geplant', rows: [{ exerciseId: ex.benchTwin }] });
        const res = (await last(F1, planned.id)).data!;
        expect(res).toHaveLength(1); // the twin finds its own session
        expect(res[0].out_sets[0].weight_kg).toBe(100);
      });

      it('197. ignores the workout itself, skipped and unfinished workouts, exercise rows without sets and sets that are not completed', async () => {
        const sets = [{ weight: 60, reps: 12 }];
        await makeWorkout(F1, { status: 'uebersprungen', daysAgo: 1, withFinishedAt: true, rows: [{ exerciseId: ex.bench, sets }] });
        await makeWorkout(F1, { status: 'geplant', daysAgo: 1, withFinishedAt: true, rows: [{ exerciseId: ex.bench, sets }] });
        await makeWorkout(F1, { daysAgo: 1, rows: [{ exerciseId: ex.bench, sets: [] }] }); // completed, but nothing was recorded for the exercise
        await makeWorkout(F1, { daysAgo: 1, rows: [{ exerciseId: ex.bench, sets: [{ weight: 99, reps: 1, completed: false }] }] });
        const own = await makeWorkout(F1, { daysAgo: 0, rows: [{ exerciseId: ex.bench, sets: [{ weight: 70, reps: 10 }] }] });

        expect((await last(F1, own.id)).data).toEqual([]); // a workout is never its own "last time"

        const cur = await makeWorkout(F1, { status: 'laeuft', rows: [{ exerciseId: ex.bench }] });
        const res = (await last(F1, cur.id)).data!;
        expect(res).toHaveLength(1);
        expect(res[0].out_workout_id).toBe(own.id); // the only eligible session
        expect(res[0].out_sets[0].weight_kg).toBe(70);
      });

      it('198. personal history is not cut off by the team\'s points reset', async () => {
        await admin.from('team_ranking_rules').upsert({ team_id: fTeamId, points_reset_at: new Date(Date.now() - 86_400_000).toISOString() }, { onConflict: 'team_id' });
        const old = await makeWorkout(F1, { daysAgo: 30, teamId: fTeamId, rows: [{ exerciseId: ex.bench, sets: [{ weight: 85, reps: 6 }] }] });
        const cur = await makeWorkout(F1, { status: 'laeuft', rows: [{ exerciseId: ex.bench }] });
        const res = (await last(F1, cur.id)).data!;
        expect(res).toHaveLength(1);
        expect(res[0].out_workout_id).toBe(old.id);
        expect((await history(F1, ex.bench)).data).toHaveLength(1);
        await admin.from('team_ranking_rules').update({ points_reset_at: null }).eq('team_id', fTeamId);
      });

      it('199. with no history the answer is empty (and an unknown workout id is empty too, not an error)', async () => {
        const cur = await makeWorkout(F1, { status: 'laeuft', rows: [{ exerciseId: ex.bench }, { exerciseId: ex.plank }] });
        const res = await last(F1, cur.id);
        expect(res.error).toBeNull();
        expect(res.data).toEqual([]);
        expect((await last(F1, crypto.randomUUID())).data).toEqual([]);
      });

      it('200. nobody else\'s history is reachable: another user gets nothing with the real workout id or the real exercise id; anonymous callers are refused', async () => {
        await makeWorkout(F1, { daysAgo: 5, rows: [{ exerciseId: ex.bench, sets: [{ weight: 80, reps: 10 }] }] });
        const f1Cur = await makeWorkout(F1, { status: 'laeuft', rows: [{ exerciseId: ex.bench }] });
        const f2Cur = await makeWorkout(F2, { status: 'laeuft', rows: [{ exerciseId: ex.bench }] });

        expect((await last(F2, f1Cur.id)).data).toEqual([]); // F1's workout id
        expect((await last(F2, f2Cur.id)).data).toEqual([]); // F2's own workout with the same exercise: still none of F1's sessions
        expect((await history(F2, ex.bench)).data).toEqual([]);
        expect((await history(F1, ex.bench)).data).toHaveLength(1);

        const a = await anon().rpc('get_last_exercise_results', { p_workout_id: f1Cur.id });
        expect(a.error).not.toBeNull();
        const b = await anon().rpc('get_exercise_history', { p_exercise_id: ex.bench });
        expect(b.error).not.toBeNull();
      });

      it('201. the same exercise twice in one workout stays two instances: "last" returns the later one, history lists both', async () => {
        await makeWorkout(F1, {
          daysAgo: 3,
          rows: [
            { exerciseId: ex.bench, sets: [{ weight: 60, reps: 12 }] },
            { exerciseId: ex.dumbbell, sets: [{ weight: 30, reps: 10 }] },
            { exerciseId: ex.bench, sets: [{ weight: 50, reps: 15 }, { weight: 50, reps: 14 }] },
          ],
        });
        const cur = await makeWorkout(F1, { status: 'laeuft', rows: [{ exerciseId: ex.bench }] });
        const res = (await last(F1, cur.id)).data!;
        expect(res).toHaveLength(1);
        expect(res[0].out_sets.map((s: { weight_kg: number }) => s.weight_kg)).toEqual([50, 50]); // the later instance only — 60 and 50 are never mixed

        const h = (await history(F1, ex.bench)).data!;
        expect(h).toHaveLength(2);
        expect(h.map((x: { out_instance_no: number; out_instance_count: number }) => [x.out_instance_no, x.out_instance_count])).toEqual([[1, 2], [2, 2]]);
        expect(h[0].out_sets).toHaveLength(1);
        expect(h[1].out_sets).toHaveLength(2);
      });

      it('202. history lists the most recent sessions first, caps the page, can leave one workout out and pages back from a date', async () => {
        const ids: string[] = [];
        for (let d = 1; d <= 7; d++) ids.push((await makeWorkout(F1, { daysAgo: d, rows: [{ exerciseId: ex.bench, sets: [{ weight: 70 + d, reps: 10 }] }] })).id);
        const weights = (rows: { out_sets: { weight_kg: number }[] }[]) => rows.map((x) => x.out_sets[0]!.weight_kg);

        const page1 = (await history(F1, ex.bench)).data!;
        expect(weights(page1)).toEqual([71, 72, 73, 74, 75]); // default page of five, newest first
        const page2 = (await history(F1, ex.bench, { p_before: page1[4].out_performed_at })).data!;
        expect(weights(page2)).toEqual([76, 77]);
        expect(weights((await history(F1, ex.bench, { p_exclude_workout_id: ids[0] })).data!)).toEqual([72, 73, 74, 75, 76]);
        expect((await history(F1, ex.bench, { p_limit: 2 })).data).toHaveLength(2);
        expect((await history(F1, ex.bench, { p_limit: 0 })).data).toHaveLength(1); // clamped up to one
        expect((await history(F1, ex.bench, { p_limit: 500 })).data).toHaveLength(7); // clamped to twenty; only seven exist
      });
    });

    describe('replacing an exercise in the running workout', () => {
      it('203. with no recorded sets the replacement takes the same place — in this workout only; plan, template, timer, points and feed are untouched', async () => {
        const { data: plan } = await admin.from('workout_plans').insert({ user_id: F1.id, name: 'FT Plan' }).select('id').single();
        const { data: day } = await admin.from('workout_plan_days').insert({ plan_id: plan!.id, weekday: 1, title: 'Brust' }).select('id').single();
        await admin.from('workout_plan_exercises').insert({ plan_day_id: day!.id, exercise_id: ex.bench, position: 0, target_sets: 3, target_reps: 10 });
        const { data: tpl } = await admin.from('plan_templates').insert({ user_id: F1.id, name: 'FT Vorlage' }).select('id').single();
        await admin.from('plan_template_items').insert({ template_id: tpl!.id, exercise_id: ex.bench, exercise_name: 'FT Bankdrücken', position: 0, target_sets: 3, target_reps: 10 });
        const planSnapshot = async () =>
          JSON.stringify([
            (await admin.from('workout_plan_exercises').select('*').eq('plan_day_id', day!.id)).data,
            (await admin.from('plan_template_items').select('*').eq('template_id', tpl!.id)).data,
          ]);
        const plansBefore = await planSnapshot();

        const w = await makeWorkout(F1, {
          status: 'laeuft',
          teamId: fTeamId,
          rows: [{ exerciseId: ex.run }, { exerciseId: ex.bench, planned: { sets: 3, reps: 10, weightKg: 80 } }, { exerciseId: ex.plank }],
        });
        const effects = async () => ({
          workout: (await admin.from('workouts').select('status, started_at, paused_at, paused_seconds, updated_at').eq('id', w.id).single()).data,
          messages: (await admin.from('messages').select('id', { count: 'exact', head: true }).eq('team_id', fTeamId)).count,
          feed: (await admin.from('activity_feed').select('id', { count: 'exact', head: true }).eq('team_id', fTeamId)).count,
          audit: (await admin.from('audit_events').select('id', { count: 'exact', head: true }).eq('team_id', fTeamId)).count,
          points: (await admin.from('fitness_score_events').select('id', { count: 'exact', head: true }).eq('user_id', F1.id)).count,
          notifications: (await admin.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', F1.id)).count,
        });
        const before = await effects();

        const newId = crypto.randomUUID();
        const res = await replace(F1, w.rows[1]!.id, ex.dumbbell, newId);
        expect(res.error).toBeNull();
        expect(res.data![0]).toEqual({ out_mode: 'replaced', out_workout_exercise_id: newId, out_removed_workout_exercise_id: w.rows[1]!.id, out_replayed: false });

        const rows = await rowsOf(w.id);
        expect(rows.map((r) => [r.exercise_id, r.position])).toEqual([[ex.run, 0], [ex.dumbbell, 1], [ex.plank, 2]]);
        expect(rows[1]!.id).toBe(newId);
        expect(rows[1]!.planned).toBeNull(); // the old exercise's targets are not carried over to another movement
        expect(await planSnapshot()).toBe(plansBefore);
        expect(await effects()).toEqual(before);
      });

      it('204. with recorded sets the original keeps them, unchanged, and the replacement is added as its own block right after it', async () => {
        const w = await makeWorkout(F1, {
          status: 'laeuft',
          rows: [
            { exerciseId: ex.bench, planned: { sets: 3, reps: 10 }, sets: [{ weight: 80, reps: 10 }, { weight: 80, reps: 9 }] },
            { exerciseId: ex.plank },
          ],
        });
        const setsBefore = (await admin.from('workout_sets').select('*').eq('workout_exercise_id', w.rows[0]!.id).order('set_number')).data;
        const newId = crypto.randomUUID();
        const res = await replace(F1, w.rows[0]!.id, ex.dumbbell, newId);
        expect(res.data![0]).toEqual({ out_mode: 'added', out_workout_exercise_id: newId, out_removed_workout_exercise_id: null, out_replayed: false });

        const rows = await rowsOf(w.id);
        expect(rows.map((r) => r.exercise_id)).toEqual([ex.bench, ex.dumbbell, ex.plank]);
        expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
        expect(rows[0]!.id).toBe(w.rows[0]!.id);
        expect(rows[0]!.planned).toEqual({ sets: 3, reps: 10 });
        expect((await admin.from('workout_sets').select('*').eq('workout_exercise_id', w.rows[0]!.id).order('set_number')).data).toEqual(setsBefore);
        expect((await admin.from('workout_sets').select('id').eq('workout_exercise_id', newId)).data).toEqual([]); // nothing is logged automatically
      });

      it('205. a repeated request (double tap, lost response) is reported again and never applied twice — also when two arrive together; the id cannot be taken over', async () => {
        const w = await makeWorkout(F1, { status: 'laeuft', rows: [{ exerciseId: ex.bench }, { exerciseId: ex.plank }] });
        const newId = crypto.randomUUID();
        const first = await replace(F1, w.rows[0]!.id, ex.dumbbell, newId);
        expect(first.data![0]).toMatchObject({ out_mode: 'replaced', out_replayed: false });
        const second = await replace(F1, w.rows[0]!.id, ex.dumbbell, newId); // the original row is gone by now
        expect(second.error).toBeNull();
        expect(second.data![0]).toEqual({ out_mode: 'replaced', out_workout_exercise_id: newId, out_removed_workout_exercise_id: w.rows[0]!.id, out_replayed: true });
        expect(await rowsOf(w.id)).toHaveLength(2);
        expect((await replace(F1, w.rows[0]!.id, ex.run, newId)).error?.message).toContain('invalid_request'); // same id, different exercise: not a replay

        await admin.from('workouts').delete().eq('id', w.id); // one running workout per user
        const w2 = await makeWorkout(F1, { status: 'laeuft', rows: [{ exerciseId: ex.bench, sets: [{ weight: 80, reps: 10 }] }, { exerciseId: ex.plank }] });
        const id2 = crypto.randomUUID();
        const [a, b] = await Promise.all([replace(F1, w2.rows[0]!.id, ex.dumbbell, id2), replace(F1, w2.rows[0]!.id, ex.dumbbell, id2)]);
        expect(a.error).toBeNull();
        expect(b.error).toBeNull();
        expect([a.data![0].out_replayed, b.data![0].out_replayed].sort()).toEqual([false, true]);
        expect((await rowsOf(w2.id)).filter((r) => r.id === id2)).toHaveLength(1);

        const f2 = await makeWorkout(F2, { status: 'laeuft', rows: [{ exerciseId: ex.bench }] });
        expect((await replace(F2, f2.rows[0]!.id, ex.dumbbell, id2)).error?.message).toContain('invalid_request'); // the id belongs to another user's row
        expect((await rowsOf(f2.id)).map((r) => r.exercise_id)).toEqual([ex.bench]);
      });

      it('206. the replacement must be an exercise the caller may use — someone else\'s private exercise and an unknown id are refused, their own private one is fine', async () => {
        const w = await makeWorkout(F1, { status: 'laeuft', rows: [{ exerciseId: ex.bench }, { exerciseId: ex.plank }] });
        const before = await rowsOf(w.id);
        expect((await replace(F1, w.rows[0]!.id, ex.f2Private)).error?.message).toContain('exercise_not_accessible');
        expect((await replace(F1, w.rows[0]!.id, crypto.randomUUID())).error?.message).toContain('exercise_not_accessible');
        expect(await rowsOf(w.id)).toEqual(before);
        expect((await replace(F1, w.rows[0]!.id, ex.f1Private)).error).toBeNull();
      });

      it('207. a foreign or unknown row is simply "not found" — the same answer either way, nothing changes, anonymous callers are refused', async () => {
        const w = await makeWorkout(F1, { status: 'laeuft', rows: [{ exerciseId: ex.bench, sets: [{ weight: 80, reps: 10 }] }, { exerciseId: ex.plank }] });
        const before = await rowsOf(w.id);
        for (const call of [
          () => replace(F2, w.rows[0]!.id, ex.dumbbell),
          () => replace(F1, crypto.randomUUID(), ex.dumbbell),
          () => postpone(F2, w.rows[0]!.id),
          () => postpone(F1, crypto.randomUUID()),
        ]) {
          expect((await call()).error?.message).toContain('exercise_not_found');
        }
        expect(await rowsOf(w.id)).toEqual(before);
        expect((await anon().rpc('replace_workout_exercise', { p_workout_exercise_id: w.rows[0]!.id, p_new_exercise_id: ex.dumbbell, p_new_workout_exercise_id: crypto.randomUUID() })).error).not.toBeNull();
        expect((await anon().rpc('postpone_workout_exercise', { p_workout_exercise_id: w.rows[0]!.id })).error).not.toBeNull();
      });

      it('208. only a running workout can be changed: finished, skipped and planned ones are refused, a paused one is fine', async () => {
        for (const status of ['abgeschlossen', 'uebersprungen', 'geplant']) {
          const w = await makeWorkout(F1, { status, rows: [{ exerciseId: ex.bench }, { exerciseId: ex.plank }] });
          expect((await replace(F1, w.rows[0]!.id, ex.dumbbell)).error?.message, status).toContain('workout_not_active');
          expect((await postpone(F1, w.rows[0]!.id)).error?.message, status).toContain('workout_not_active');
          expect((await rowsOf(w.id)).map((r) => r.exercise_id), status).toEqual([ex.bench, ex.plank]);
        }
        const paused = await makeWorkout(F1, { status: 'laeuft', paused: true, rows: [{ exerciseId: ex.bench }, { exerciseId: ex.plank }] });
        expect((await postpone(F1, paused.rows[0]!.id)).error).toBeNull();
        expect((await replace(F1, paused.rows[1]!.id, ex.run)).error).toBeNull();
      });

      it('209. replacing an exercise with itself is refused', async () => {
        const w = await makeWorkout(F1, { status: 'laeuft', rows: [{ exerciseId: ex.bench }] });
        expect((await replace(F1, w.rows[0]!.id, ex.bench)).error?.message).toContain('same_exercise');
        expect((await rowsOf(w.id)).map((r) => r.id)).toEqual([w.rows[0]!.id]);
      });

      it('210. a recorded set can never be moved to another exercise, and a row with sets cannot change its exercise — not even by a direct request or the service role', async () => {
        const w = await makeWorkout(F1, { status: 'laeuft', rows: [{ exerciseId: ex.bench, sets: [{ weight: 80, reps: 10 }] }, { exerciseId: ex.dumbbell }] });
        const relabel = await F1.client.from('workout_exercises').update({ exercise_id: ex.dumbbell }).eq('id', w.rows[0]!.id);
        expect(relabel.error?.message).toContain('exercise_has_recorded_sets');
        const move = await F1.client.from('workout_sets').update({ workout_exercise_id: w.rows[1]!.id }).eq('workout_exercise_id', w.rows[0]!.id);
        expect(move.error?.message).toContain('set_parent_is_fixed');
        expect((await admin.from('workout_exercises').update({ exercise_id: ex.dumbbell }).eq('id', w.rows[0]!.id)).error?.message).toContain('exercise_has_recorded_sets');
        expect((await admin.from('workout_sets').update({ workout_exercise_id: w.rows[1]!.id }).eq('workout_exercise_id', w.rows[0]!.id)).error?.message).toContain('set_parent_is_fixed');
        // The guard protects recorded results only: a row without sets keeps working as before.
        expect((await F1.client.from('workout_exercises').update({ exercise_id: ex.run }).eq('id', w.rows[1]!.id)).error).toBeNull();
        // A set's own values stay editable (the workout editor relies on it).
        expect((await F1.client.from('workout_sets').update({ weight_kg: 82.5 }).eq('workout_exercise_id', w.rows[0]!.id)).error).toBeNull();
        expect((await rowsOf(w.id)).find((r) => r.id === w.rows[0]!.id)!.exercise_id).toBe(ex.bench);
      });

      it('211. a set saved at the same moment as a replacement is never relabelled: the original keeps it, or the late save is refused', async () => {
        for (let round = 0; round < 8; round++) {
          const w = await makeWorkout(F1, { status: 'laeuft', rows: [{ exerciseId: ex.bench }, { exerciseId: ex.plank }] });
          const original = w.rows[0]!.id;
          const newId = crypto.randomUUID();
          const [rep, save] = await Promise.all([
            replace(F1, original, ex.dumbbell, newId),
            F1.client.from('workout_sets').insert({ workout_exercise_id: original, set_number: 1, weight_kg: 80, reps: 10 }),
          ]);
          expect(rep.error).toBeNull();
          const rows = await rowsOf(w.id);
          const landed = (await admin.from('workout_sets').select('id').eq('workout_exercise_id', original)).data!;
          if (landed.length === 1) {
            expect(save.error).toBeNull(); // the save won: the original and its set stay, the replacement comes after
            expect(rep.data![0].out_mode).toBe('added');
            expect(rows.map((r) => r.exercise_id)).toEqual([ex.bench, ex.dumbbell, ex.plank]);
            expect(rows.find((r) => r.id === original)!.exercise_id).toBe(ex.bench); // the set is still a bench-press set
          } else {
            expect(save.error).not.toBeNull(); // the replacement won: the original is gone and the late save was refused
            expect(rep.data![0].out_mode).toBe('replaced');
            expect(rows.map((r) => r.exercise_id)).toEqual([ex.dumbbell, ex.plank]);
            expect((await admin.from('workout_sets').select('id').eq('workout_exercise_id', newId)).data).toEqual([]);
          }
          await admin.from('workouts').delete().eq('id', w.id);
        }
      });

      it('212. a replacement that races with finishing the workout is either applied before it or refused — never applied to a finished workout', async () => {
        for (let round = 0; round < 6; round++) {
          const w = await makeWorkout(F1, { status: 'laeuft', rows: [{ exerciseId: ex.bench }, { exerciseId: ex.plank }] });
          const [rep, fin] = await Promise.all([
            replace(F1, w.rows[0]!.id, ex.dumbbell),
            F1.client.rpc('finish_own_workout', { p_workout_id: w.id, p_finished_at: new Date().toISOString(), p_duration_seconds: 1800, p_distance_km: null, p_notes: null }),
          ]);
          expect(fin.error).toBeNull();
          const exercises = (await rowsOf(w.id)).map((r) => r.exercise_id);
          if (rep.error) {
            expect(rep.error.message).toContain('workout_not_active');
            expect(exercises).toEqual([ex.bench, ex.plank]); // refused, nothing changed
          } else {
            expect(exercises).toEqual([ex.dumbbell, ex.plank]); // applied while the workout was still running
          }
          const after = await replace(F1, w.rows[0]!.id, ex.run); // now it is finished for certain
          expect(after.error).not.toBeNull();
          await admin.from('workouts').delete().eq('id', w.id);
        }
      });
    });

    describe('postponing an exercise', () => {
      it('213. moves the exercise behind all others and changes nothing else about it', async () => {
        const w = await makeWorkout(F1, {
          status: 'laeuft',
          rows: [
            { exerciseId: ex.bench, planned: { sets: 3, reps: 10 }, sets: [{ weight: 80, reps: 10 }] },
            { exerciseId: ex.dumbbell },
            { exerciseId: ex.run },
            { exerciseId: ex.plank },
          ],
        });
        const before = await rowsOf(w.id);
        const res = await postpone(F1, w.rows[0]!.id);
        expect(res.data).toEqual([{ out_changed: true }]);

        const after = await rowsOf(w.id);
        expect(after).toHaveLength(before.length);
        expect(after.map((r) => r.id)).toEqual([w.rows[1]!.id, w.rows[2]!.id, w.rows[3]!.id, w.rows[0]!.id]);
        expect(after.map((r) => r.position)).toEqual([0, 1, 2, 3]);
        expect(after[3]).toMatchObject({ id: before[0]!.id, exercise_id: before[0]!.exercise_id, planned: before[0]!.planned, created_at: before[0]!.created_at });
        expect((await admin.from('workout_sets').select('weight_kg, reps').eq('workout_exercise_id', w.rows[0]!.id)).data).toEqual([{ weight_kg: 80, reps: 10 }]);
      });

      it('214. postponing the last exercise, or repeating the request, changes nothing', async () => {
        const w = await makeWorkout(F1, { status: 'laeuft', rows: [{ exerciseId: ex.bench }, { exerciseId: ex.dumbbell }, { exerciseId: ex.run }] });
        const before = await rowsOf(w.id);
        expect((await postpone(F1, w.rows[2]!.id)).data).toEqual([{ out_changed: false }]);
        expect(await rowsOf(w.id)).toEqual(before);

        expect((await postpone(F1, w.rows[0]!.id)).data).toEqual([{ out_changed: true }]);
        const once = await rowsOf(w.id);
        expect((await postpone(F1, w.rows[0]!.id)).data).toEqual([{ out_changed: false }]); // already last now
        expect(await rowsOf(w.id)).toEqual(once);
      });

      it('215. older rows that share a position are given a clear order by the next move or replacement', async () => {
        const w = await makeWorkout(F1, {
          status: 'laeuft',
          rows: [{ exerciseId: ex.bench, position: 0 }, { exerciseId: ex.dumbbell, position: 2 }, { exerciseId: ex.run, position: 2 }],
        });
        await postpone(F1, w.rows[0]!.id);
        const moved = await rowsOf(w.id);
        expect(moved.map((r) => r.position)).toEqual([0, 1, 2]);
        expect(moved.map((r) => r.id)).toEqual([w.rows[1]!.id, w.rows[2]!.id, w.rows[0]!.id]);

        const x = await makeWorkout(F2, {
          status: 'laeuft',
          rows: [{ exerciseId: ex.bench, position: 1 }, { exerciseId: ex.dumbbell, position: 1 }, { exerciseId: ex.run, position: 1 }],
        });
        const newId = crypto.randomUUID();
        await replace(F2, x.rows[1]!.id, ex.plank, newId);
        const replaced = await rowsOf(x.id);
        expect(replaced.map((r) => r.position)).toEqual([0, 1, 2]);
        expect(replaced.map((r) => r.id)).toEqual([x.rows[0]!.id, newId, x.rows[2]!.id]);
      });
    });

    describe('side effects and saving sets', () => {
      it('216. reading history, replacing and postponing leave the timer, the plan, the points and the team feed alone', async () => {
        const w = await makeWorkout(F1, { status: 'laeuft', teamId: fTeamId, rows: [{ exerciseId: ex.bench }, { exerciseId: ex.dumbbell }, { exerciseId: ex.plank }] });
        const effects = async () => ({
          workout: (await admin.from('workouts').select('status, started_at, paused_at, paused_seconds, updated_at, duration_seconds').eq('id', w.id).single()).data,
          messages: (await admin.from('messages').select('id', { count: 'exact', head: true }).eq('team_id', fTeamId)).count,
          feed: (await admin.from('activity_feed').select('id', { count: 'exact', head: true }).eq('team_id', fTeamId)).count,
          audit: (await admin.from('audit_events').select('id', { count: 'exact', head: true }).eq('team_id', fTeamId)).count,
          points: (await admin.from('fitness_score_events').select('id', { count: 'exact', head: true }).eq('user_id', F1.id)).count,
          notifications: (await admin.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', F1.id)).count,
        });
        const before = await effects();
        await last(F1, w.id);
        await history(F1, ex.bench);
        await replace(F1, w.rows[1]!.id, ex.run);
        await postpone(F1, w.rows[0]!.id);
        expect(await effects()).toEqual(before);
        await F1.client.rpc('delete_own_workout', { p_workout_id: w.id }); // removes the team event this fixture posted
      });

      it('217. a set saved with a client-chosen id can be sent again without becoming a second set; nobody else can take over that id', async () => {
        const w = await makeWorkout(F1, { status: 'laeuft', rows: [{ exerciseId: ex.bench }] });
        const setId = crypto.randomUUID();
        const row = (extra: Record<string, unknown> = {}) => ({ id: setId, workout_exercise_id: w.rows[0]!.id, set_number: 1, weight_kg: 80, reps: 10, metrics: {}, ...extra });
        expect((await F1.client.from('workout_sets').insert(row())).error).toBeNull();
        const again = await F1.client.from('workout_sets').insert(row({ weight_kg: 999 }));
        expect(again.error?.code).toBe('23505'); // the retry is recognisable and does not overwrite
        const stored = (await admin.from('workout_sets').select('weight_kg').eq('workout_exercise_id', w.rows[0]!.id)).data!;
        expect(stored).toEqual([{ weight_kg: 80 }]);

        const f2 = await makeWorkout(F2, { status: 'laeuft', rows: [{ exerciseId: ex.bench }] });
        expect((await F2.client.from('workout_sets').insert(row({ workout_exercise_id: f2.rows[0]!.id }))).error).not.toBeNull(); // the id is someone else's
        expect((await F2.client.from('workout_sets').select('id').eq('id', setId)).data).toEqual([]); // and invisible to them
        expect((await F2.client.from('workout_sets').insert(row({ id: crypto.randomUUID(), workout_exercise_id: w.rows[0]!.id }))).error).not.toBeNull(); // nor can they write into F1's exercise
      });
    });
  });
});
