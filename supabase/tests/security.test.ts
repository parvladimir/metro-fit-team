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

    it('33. cannot react as someone else, on a human message, or as an outsider; outsider cannot read reactions', async () => {
      const forge = await userB.client.from('message_reactions').insert({ message_id: eventId, user_id: userA.id });
      expect(forge.error).not.toBeNull();
      const human = await userB.client.from('message_reactions').insert({ message_id: humanId, user_id: userB.id });
      expect(human.error).not.toBeNull();
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

      await userA.client.from('message_reactions').insert({ message_id: started, user_id: userA.id });
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
});
