-- ---------------------------------------------------------------------------
-- ONE-TIME, AUDITABLE cleanup of demo/test APPLICATION data (not auth).
--
-- Touches NO auth.users row, password, email, session, profile row, or
-- team_members row: Thorsten Roloff stays a team_admin of the METRO Marl
-- Fitness Team.
--
-- Cutoff = the real joined_at of "Volodymyr Parashchak" in that team (read
-- from the database, not hard-coded). Everything created BEFORE it in the
-- team's "Letzte Aktivitäten" is treated as seed/demo data. Real joins that
-- happened after (Tim A, Osama, Smiley, Dennis Epskamp, Özcan Altay, ...)
-- and all human chat messages are kept.
--
-- Additionally Thorsten's own workouts/activities/scores/achievements/
-- challenge progress are reset: they were all created while testing the app
-- with his demo account (750 artificial points), so he starts at 0.
-- The rollup table fitness_score_totals is rebuilt implicitly: his rows are
-- deleted together with his events (it is only maintained by INSERT
-- triggers, deleting events alone would leave stale totals behind).
-- Idempotent: running it twice deletes nothing the second time.
-- ---------------------------------------------------------------------------
do $$
declare
  v_team uuid;
  v_thorsten uuid;
  v_cutoff timestamptz;
  n int;
begin
  select id into v_team from public.teams where name = 'METRO Marl Fitness Team' limit 1;
  if v_team is null then raise exception 'cleanup aborted: team not found'; end if;

  select tm.joined_at into v_cutoff
  from public.team_members tm join public.profiles p on p.id = tm.user_id
  where tm.team_id = v_team and p.full_name ilike 'volodymyr parashchak' limit 1;
  if v_cutoff is null then raise exception 'cleanup aborted: cutoff member not found'; end if;

  select p.id into v_thorsten
  from public.team_members tm join public.profiles p on p.id = tm.user_id
  where tm.team_id = v_team and tm.role = 'team_admin' and p.full_name = 'Thorsten Roloff' limit 1;
  if v_thorsten is null then raise exception 'cleanup aborted: admin not found'; end if;

  raise notice 'cleanup cutoff = %, admin = %', v_cutoff, v_thorsten;

  delete from public.activity_feed where team_id = v_team and created_at < v_cutoff;
  get diagnostics n = row_count; raise notice 'activity_feed (pre-cutoff): %', n;

  delete from public.activity_feed where user_id = v_thorsten;
  get diagnostics n = row_count; raise notice 'activity_feed (admin test entries): %', n;

  delete from public.workouts where user_id = v_thorsten;
  get diagnostics n = row_count; raise notice 'workouts (+ exercises/sets by cascade): %', n;

  delete from public.activities where user_id = v_thorsten;
  get diagnostics n = row_count; raise notice 'activities: %', n;

  delete from public.fitness_score_events where user_id = v_thorsten;
  get diagnostics n = row_count; raise notice 'fitness_score_events: %', n;

  delete from public.fitness_score_totals where user_id = v_thorsten;
  get diagnostics n = row_count; raise notice 'fitness_score_totals: %', n;

  delete from public.user_achievements where user_id = v_thorsten;
  get diagnostics n = row_count; raise notice 'user_achievements: %', n;

  delete from public.challenge_participants where user_id = v_thorsten;
  get diagnostics n = row_count; raise notice 'challenge_participants: %', n;

  insert into public.audit_events (team_id, actor_user_id, action, entity_type, metadata)
  values (v_team, v_thorsten, 'test_data_cleanup', 'team',
          jsonb_build_object('cutoff', v_cutoff, 'migration', '0026_cleanup_thorsten_test_data'));
end $$;
