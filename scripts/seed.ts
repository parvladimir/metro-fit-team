/**
 * Demo data seeding for local development / test deployments.
 * NOT for production — creates real Supabase Auth users with generated
 * passwords (printed once at the end) purely for exploring the app.
 *
 * Usage: npm run seed
 */
import { randomBytes } from 'node:crypto';
import { getAdminClient, getEnv, slugify } from './lib';

const DEMO_MEMBERS = [
  { name: 'Vladimir', email: 'vladimir@demo.metro-fit-team.local', goal: 'build_muscle', weeklyGoal: 4 },
  { name: 'Daniel', email: 'daniel@demo.metro-fit-team.local', goal: 'improve_strength', weeklyGoal: 3 },
  { name: 'Alex', email: 'alex@demo.metro-fit-team.local', goal: 'general_fitness', weeklyGoal: 5 },
  { name: 'Markus', email: 'markus@demo.metro-fit-team.local', goal: 'lose_weight', weeklyGoal: 3 },
  { name: 'Anna', email: 'anna@demo.metro-fit-team.local', goal: 'improve_endurance', weeklyGoal: 4 },
] as const;

function randomPassword() {
  return randomBytes(9).toString('base64url');
}

function daysAgo(n: number) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

async function ensureUser(admin: ReturnType<typeof getAdminClient>, email: string, fullName: string) {
  const password = randomPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (!error) return { id: data.user.id, password, created: true };

  // Already exists — look it up instead.
  let page = 1;
  while (true) {
    const { data: list, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listError) throw listError;
    const match = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return { id: match.id, password: null, created: false };
    if (list.users.length < 200) throw new Error(`Could not find or create user ${email}`);
    page += 1;
  }
}

async function main() {
  const admin = getAdminClient();
  const { initialAdminEmail, initialTeamName } = getEnv();

  if (!initialAdminEmail) throw new Error('INITIAL_ADMIN_EMAIL must be set before seeding.');

  console.log(`Seeding demo team "${initialTeamName}"...`);

  const thorsten = await ensureUser(admin, initialAdminEmail, 'Thorsten Roloff');
  const slug = slugify(initialTeamName);

  const { data: existingTeam } = await admin.from('teams').select('id').eq('slug', slug).maybeSingle();
  let teamId = existingTeam?.id as string | undefined;

  if (!teamId) {
    const { data: newTeam, error } = await admin
      .from('teams')
      .insert({ name: initialTeamName, slug, created_by: thorsten.id })
      .select('id')
      .single();
    if (error) throw error;
    teamId = newTeam.id;
  }

  await admin.from('team_members').upsert({ team_id: teamId, user_id: thorsten.id, role: 'team_admin' }, { onConflict: 'team_id,user_id' });
  await admin.from('profiles').update({ full_name: 'Thorsten Roloff', onboarding_completed_at: new Date().toISOString(), weekly_goal: 4, fitness_goal: 'stay_fit' }).eq('id', thorsten.id);

  const credentials: { name: string; email: string; password: string | null }[] = [
    { name: 'Thorsten Roloff', email: initialAdminEmail, password: thorsten.password },
  ];

  const memberIds: { id: string; name: string }[] = [{ id: thorsten.id, name: 'Thorsten Roloff' }];

  for (const member of DEMO_MEMBERS) {
    const user = await ensureUser(admin, member.email, member.name);
    await admin.from('team_members').upsert({ team_id: teamId, user_id: user.id, role: 'member' }, { onConflict: 'team_id,user_id' });
    await admin
      .from('profiles')
      .update({ full_name: member.name, onboarding_completed_at: new Date().toISOString(), weekly_goal: member.weeklyGoal, fitness_goal: member.goal })
      .eq('id', user.id);
    credentials.push({ name: member.name, email: member.email, password: user.password });
    memberIds.push({ id: user.id, name: member.name });
  }

  // ---- exercise lookups (seeded via supabase/seed.sql) ---------------------
  const { data: exercises } = await admin.from('exercises').select('id, name').is('team_id', null);
  const exerciseByName = new Map((exercises ?? []).map((e) => [e.name, e.id]));
  const benchPress = exerciseByName.get('Bankdrücken');

  // ---- weekly plan template for each member --------------------------------
  const planDays = [
    { weekday: 1, title: 'Brust & Trizeps' },
    { weekday: 3, title: 'Rücken & Bizeps' },
    { weekday: 5, title: 'Beine' },
    { weekday: 7, title: 'Cardio' },
  ];

  for (const member of memberIds) {
    const { data: existingPlan } = await admin
      .from('workout_plans')
      .select('id')
      .eq('user_id', member.id)
      .eq('is_active', true)
      .maybeSingle();

    const plan =
      existingPlan ??
      (
        await admin
          .from('workout_plans')
          .insert({ user_id: member.id, name: 'Standardplan', is_active: true })
          .select('id')
          .single()
      ).data;

    if (!plan) continue;

    for (const day of planDays) {
      await admin.from('workout_plan_days').upsert({ plan_id: plan.id, weekday: day.weekday, title: day.title }, { onConflict: 'plan_id,weekday' });
    }
  }

  // ---- historical completed workouts (drives fitness score + feed) --------
  for (const member of memberIds) {
    for (let i = 0; i < 6; i++) {
      const scheduledDate = daysAgo(i * 2 + 1);
      const durationMinutes = 35 + Math.round(Math.random() * 40);

      const { data: workout } = await admin
        .from('workouts')
        .insert({
          user_id: member.id,
          team_id: teamId,
          activity_type: i % 3 === 0 ? 'laufen' : 'krafttraining',
          title: i % 3 === 0 ? 'Lauftraining' : 'Krafttraining',
          status: 'geplant',
          scheduled_date: scheduledDate.toISOString().slice(0, 10),
          started_at: scheduledDate.toISOString(),
        })
        .select('id')
        .single();

      if (!workout) continue;

      if (benchPress && i % 3 !== 0) {
        const { data: we } = await admin.from('workout_exercises').insert({ workout_id: workout.id, exercise_id: benchPress, position: 0 }).select('id').single();
        if (we) {
          await admin.from('workout_sets').insert([
            { workout_exercise_id: we.id, set_number: 1, weight_kg: 60 + i, reps: 10 },
            { workout_exercise_id: we.id, set_number: 2, weight_kg: 60 + i, reps: 9 },
            { workout_exercise_id: we.id, set_number: 3, weight_kg: 60 + i, reps: 8 },
          ]);
        }
      }

      // Transition geplant -> abgeschlossen so the scoring trigger fires.
      const finishedAt = new Date(scheduledDate.getTime() + durationMinutes * 60 * 1000);
      await admin
        .from('workouts')
        .update({ status: 'abgeschlossen', finished_at: finishedAt.toISOString(), duration_seconds: durationMinutes * 60 })
        .eq('id', workout.id);
    }

    // ---- body measurements (private, owner-only) ---------------------------
    for (let w = 0; w < 4; w++) {
      await admin.from('body_measurements').upsert(
        {
          user_id: member.id,
          measured_at: daysAgo(w * 7).toISOString().slice(0, 10),
          weight_kg: 78 - w * 0.4 + Math.random(),
          waist_cm: 86 - w * 0.2,
        },
        { onConflict: 'user_id,measured_at' }
      );
    }
  }

  // ---- team challenge -------------------------------------------------------
  const { data: challenge } = await admin
    .from('challenges')
    .insert({
      team_id: teamId,
      title: '4 Trainings diese Woche',
      description: 'Schließe diese Woche 4 Trainings ab.',
      challenge_type: 'individual',
      metric: 'workouts_count',
      target_value: 4,
      starts_at: daysAgo(2).toISOString().slice(0, 10),
      ends_at: daysAgo(-5).toISOString().slice(0, 10),
      points_reward: 100,
      created_by: thorsten.id,
    })
    .select('id')
    .single();

  if (challenge) {
    for (const [i, member] of memberIds.entries()) {
      await admin.from('challenge_participants').upsert(
        { challenge_id: challenge.id, user_id: member.id, progress_value: Math.min(4, i + 1) },
        { onConflict: 'challenge_id,user_id' }
      );
    }
  }

  // ---- chat messages ---------------------------------------------------------
  const chatLines = [
    { name: 'Alex', text: 'Wer ist heute Abend im Gym? 💪' },
    { name: 'Anna', text: 'Ich bin ab 18 Uhr da!' },
    { name: 'Daniel', text: 'Bin dabei, bringe die Fitbänder mit.' },
    { name: 'Thorsten Roloff', text: 'Nicht vergessen: Challenge endet Sonntag 🏆' },
  ];

  for (const [i, line] of chatLines.entries()) {
    const author = memberIds.find((m) => m.name === line.name);
    if (!author) continue;
    await admin.from('messages').insert({
      team_id: teamId,
      user_id: author.id,
      content: line.text,
      created_at: new Date(Date.now() - (chatLines.length - i) * 60 * 60 * 1000).toISOString(),
    });
  }

  console.log('\nSeed complete. Demo login credentials (local/test only):\n');
  for (const c of credentials) {
    console.log(`  ${c.name.padEnd(18)} ${c.email.padEnd(38)} ${c.password ?? '(already existed — password unchanged)'}`);
  }
  console.log('\nThorsten Roloff will become team_admin automatically the first time he signs in (or immediately via the row above).');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
