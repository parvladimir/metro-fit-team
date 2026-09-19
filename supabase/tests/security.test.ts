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
});
