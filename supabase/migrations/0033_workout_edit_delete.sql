-- ---------------------------------------------------------------------------
-- Edit / delete own completed workouts, with everything derived from a
-- workout kept consistent: team activity events, feed entries, fitness score
-- ledger + weekly totals (daily cap, weekly-goal and consistency bonuses),
-- challenge progress and count-based achievements.
-- ---------------------------------------------------------------------------

-- 1. Stable relation between a workout and everything it produced.
alter table public.messages
  add column if not exists workout_id uuid references public.workouts (id) on delete cascade;
create index if not exists messages_workout_id_idx on public.messages (workout_id) where workout_id is not null;

alter table public.activity_feed
  add column if not exists workout_id uuid references public.workouts (id) on delete cascade;
create index if not exists activity_feed_workout_id_idx on public.activity_feed (workout_id) where workout_id is not null;

-- One-time backfill for events created before this migration: match by owner,
-- team and timestamp proximity (event is written by the same statement that
-- started/finished the workout). New events are linked exactly by trigger.
update public.messages m
set workout_id = (
  select w.id from public.workouts w
  where w.user_id = m.user_id and w.team_id = m.team_id
    and abs(extract(epoch from (m.created_at - case when m.event_type = 'workout_started' then w.started_at else w.finished_at end))) < 15
  order by abs(extract(epoch from (m.created_at - case when m.event_type = 'workout_started' then w.started_at else w.finished_at end)))
  limit 1
)
where m.message_type = 'system' and m.workout_id is null
  and m.event_type in ('workout_started', 'workout_completed', 'weekly_goal_reached');

update public.activity_feed f
set workout_id = (
  select w.id from public.workouts w
  where w.user_id = f.user_id and w.team_id = f.team_id and w.finished_at is not null
    and abs(extract(epoch from (f.created_at - w.finished_at))) < 15
  order by abs(extract(epoch from (f.created_at - w.finished_at)))
  limit 1
)
where f.event_type = 'workout_completed' and f.workout_id is null;

-- 2. Event writers now record the workout they belong to.
drop function if exists public.post_team_system_event(uuid, uuid, text, text, jsonb);
create or replace function public.post_team_system_event(
  p_team_id uuid, p_user_id uuid, p_event_type text, p_content text, p_metadata jsonb, p_workout_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opt boolean;
begin
  if p_team_id is null or p_user_id is null then return; end if;
  select activity_feed_opt_in into v_opt from public.privacy_settings where user_id = p_user_id;
  if not coalesce(v_opt, true) then return; end if;
  if not exists (select 1 from public.team_members where team_id = p_team_id and user_id = p_user_id) then
    return;
  end if;
  insert into public.messages (team_id, user_id, content, message_type, event_type, metadata, workout_id)
  values (p_team_id, p_user_id, p_content, 'system', p_event_type, coalesce(p_metadata, '{}'::jsonb), p_workout_id);
end;
$$;
revoke all on function public.post_team_system_event(uuid, uuid, text, text, jsonb, uuid) from public, anon, authenticated;

create or replace function public.handle_workout_chat_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week_start date;
  v_done int;
  v_goal int;
  v_title text;
begin
  if new.team_id is null then return new; end if;
  v_title := nullif(btrim(coalesce(new.title, '')), '');

  if new.status = 'laeuft' then
    if tg_op = 'UPDATE' then
      if old.status = 'laeuft' then return new; end if;
    end if;
    perform public.post_team_system_event(
      new.team_id, new.user_id, 'workout_started', 'hat ein Training gestartet',
      jsonb_build_object('title', v_title, 'activity_type', new.activity_type), new.id
    );
  end if;

  if tg_op = 'UPDATE' and new.status = 'abgeschlossen' and old.status is distinct from 'abgeschlossen' then
    perform public.post_team_system_event(
      new.team_id, new.user_id, 'workout_completed', 'hat ein Training abgeschlossen',
      jsonb_build_object(
        'title', v_title, 'activity_type', new.activity_type,
        'duration_minutes', round(coalesce(new.duration_seconds, 0) / 60.0)
      ), new.id
    );

    v_week_start := date_trunc('week', coalesce(new.finished_at, now()))::date;
    select count(*) into v_done from public.workouts
      where user_id = new.user_id and status = 'abgeschlossen'
        and finished_at >= v_week_start and finished_at < v_week_start + interval '7 days';
    select weekly_goal into v_goal from public.profiles where id = new.user_id;

    if v_done = coalesce(v_goal, 3) then
      perform public.post_team_system_event(
        new.team_id, new.user_id, 'weekly_goal_reached', 'hat das Wochenziel erreicht', '{}'::jsonb, new.id
      );
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.handle_workout_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rules public.team_ranking_rules%rowtype;
  v_week_start date;
  v_completed_this_week int;
  v_distinct_days int;
  v_weekly_goal int;
  v_total_completed int;
  v_total_seconds int;
  v_streak_weeks int;
  v_opt_in boolean;
  v_finished date;
begin
  if new.status <> 'abgeschlossen' or old.status = 'abgeschlossen' then
    return new;
  end if;

  v_finished := coalesce(new.finished_at::date, current_date);
  v_week_start := date_trunc('week', coalesce(new.finished_at, now()))::date;

  if new.team_id is not null then
    select * into v_rules from public.team_ranking_rules where team_id = new.team_id;

    perform public.award_fitness_score(
      new.user_id, new.team_id, 'workout_completed',
      coalesce(v_rules.points_workout_completed, 100), v_finished, new.id, '{}'::jsonb
    );

    if new.duration_seconds is not null
       and new.duration_seconds >= coalesce(v_rules.duration_bonus_threshold_minutes, 30) * 60 then
      perform public.award_fitness_score(
        new.user_id, new.team_id, 'workout_duration_bonus',
        coalesce(v_rules.points_duration_bonus, 40), v_finished, new.id, '{}'::jsonb
      );
    end if;

    select count(*) into v_completed_this_week
    from public.workouts
    where user_id = new.user_id and status = 'abgeschlossen'
      and finished_at >= v_week_start and finished_at < v_week_start + interval '7 days';

    select weekly_goal into v_weekly_goal from public.profiles where id = new.user_id;

    if v_completed_this_week >= coalesce(v_weekly_goal, 3) then
      perform public.award_fitness_score(
        new.user_id, new.team_id, 'weekly_goal_reached',
        coalesce(v_rules.points_weekly_goal_reached, 150), v_week_start, null, '{}'::jsonb
      );
      perform public.grant_achievement(new.user_id, 'weekly_goal_reached', new.team_id);
    end if;

    select count(distinct finished_at::date) into v_distinct_days
    from public.workouts
    where user_id = new.user_id and status = 'abgeschlossen'
      and finished_at >= v_week_start and finished_at < v_week_start + interval '7 days';

    if v_distinct_days >= coalesce(v_rules.consistency_bonus_min_days, 3) then
      perform public.award_fitness_score(
        new.user_id, new.team_id, 'consistency_bonus',
        coalesce(v_rules.points_consistency_bonus, 20), v_week_start, null, '{}'::jsonb
      );
    end if;

    select activity_feed_opt_in into v_opt_in from public.privacy_settings where user_id = new.user_id;
    if coalesce(v_opt_in, true) then
      insert into public.activity_feed (team_id, user_id, event_type, message_key, params, workout_id)
      values (
        new.team_id, new.user_id, 'workout_completed', 'feed.workoutCompleted',
        jsonb_build_object('durationMinutes', round(coalesce(new.duration_seconds, 0) / 60.0)), new.id
      );
    end if;

    perform public.recompute_challenge_progress(new.user_id, new.team_id);
  end if;

  select count(*) into v_total_completed from public.workouts where user_id = new.user_id and status = 'abgeschlossen';
  select coalesce(sum(duration_seconds), 0) into v_total_seconds from public.workouts where user_id = new.user_id and status = 'abgeschlossen';

  if v_total_completed = 1 then
    perform public.grant_achievement(new.user_id, 'first_workout', new.team_id);
  elsif v_total_completed = 10 then
    perform public.grant_achievement(new.user_id, 'ten_workouts', new.team_id);
  end if;

  if v_total_seconds >= 60000 then
    perform public.grant_achievement(new.user_id, 'thousand_minutes', new.team_id);
  end if;

  select count(*) into v_streak_weeks
  from (
    select distinct date_trunc('week', finished_at)::date as wk
    from public.workouts
    where user_id = new.user_id and status = 'abgeschlossen'
      and finished_at >= v_week_start - interval '21 days'
  ) weeks;

  if v_streak_weeks >= 4 then
    perform public.grant_achievement(new.user_id, 'four_week_streak', new.team_id);
  end if;

  return new;
end;
$$;

-- 3. Trusted server-side edits (definer functions below) may touch system
--    events; a plain user session still may not.
create or replace function public.guard_message_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null or current_user not in ('authenticated', 'anon') then return new; end if;

  if old.message_type = 'system' then
    raise exception 'system_message_not_editable' using errcode = '42501';
  end if;

  if new.user_id is distinct from old.user_id
     or new.team_id is distinct from old.team_id
     or new.message_type is distinct from old.message_type
     or new.parent_message_id is distinct from old.parent_message_id
     or new.reply_to_id is distinct from old.reply_to_id
     or new.event_type is distinct from old.event_type
     or new.created_at is distinct from old.created_at
     or new.attachment_path is distinct from old.attachment_path
     or new.attachment_mime is distinct from old.attachment_mime
     or new.attachment_width is distinct from old.attachment_width
     or new.attachment_height is distinct from old.attachment_height
     or new.metadata is distinct from old.metadata
     or new.workout_id is distinct from old.workout_id then
    raise exception 'immutable_message_field' using errcode = '42501';
  end if;

  if old.deleted_at is not null then
    raise exception 'message_deleted' using errcode = '42501';
  end if;

  if new.content is distinct from old.content then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;
  return new;
end;
$$;

-- 4. Rebuild the workout-derived score events of ONE ISO week from source
--    data (same rules and order as the completion trigger), then set that
--    week's totals to the exact ledger sum. Other weeks and non-workout
--    events (steps, challenges) are untouched.
create or replace function public.recompute_workout_scores(p_user_id uuid, p_week_start date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week_end date := p_week_start + 7;
  v_iso_year int := extract(isoyear from p_week_start)::int;
  v_iso_week int := extract(week from p_week_start)::int;
  v_goal int;
  w record;
  v_rules public.team_ranking_rules%rowtype;
  v_count int;
  v_days int;
  v_team uuid;
begin
  delete from public.fitness_score_events
  where user_id = p_user_id
    and event_type in ('workout_completed', 'workout_duration_bonus', 'weekly_goal_reached', 'consistency_bonus')
    and event_date >= p_week_start and event_date < v_week_end;

  select weekly_goal into v_goal from public.profiles where id = p_user_id;

  for w in
    select * from public.workouts
    where user_id = p_user_id and status = 'abgeschlossen' and team_id is not null
      and finished_at >= p_week_start and finished_at < v_week_end
    order by finished_at, id
  loop
    select * into v_rules from public.team_ranking_rules where team_id = w.team_id;

    perform public.award_fitness_score(w.user_id, w.team_id, 'workout_completed',
      coalesce(v_rules.points_workout_completed, 100), w.finished_at::date, w.id, '{}'::jsonb);

    if w.duration_seconds is not null
       and w.duration_seconds >= coalesce(v_rules.duration_bonus_threshold_minutes, 30) * 60 then
      perform public.award_fitness_score(w.user_id, w.team_id, 'workout_duration_bonus',
        coalesce(v_rules.points_duration_bonus, 40), w.finished_at::date, w.id, '{}'::jsonb);
    end if;

    select count(*), count(distinct finished_at::date) into v_count, v_days
    from public.workouts
    where user_id = p_user_id and status = 'abgeschlossen'
      and finished_at >= p_week_start and finished_at <= w.finished_at;

    if v_count >= coalesce(v_goal, 3) then
      perform public.award_fitness_score(w.user_id, w.team_id, 'weekly_goal_reached',
        coalesce(v_rules.points_weekly_goal_reached, 150), p_week_start, null, '{}'::jsonb);
    end if;

    if v_days >= coalesce(v_rules.consistency_bonus_min_days, 3) then
      perform public.award_fitness_score(w.user_id, w.team_id, 'consistency_bonus',
        coalesce(v_rules.points_consistency_bonus, 20), p_week_start, null, '{}'::jsonb);
    end if;
  end loop;

  for v_team in
    select team_id from public.fitness_score_events
      where user_id = p_user_id and event_date >= p_week_start and event_date < v_week_end
    union
    select team_id from public.fitness_score_totals
      where user_id = p_user_id and iso_year = v_iso_year and iso_week = v_iso_week
  loop
    insert into public.fitness_score_totals (user_id, team_id, iso_year, iso_week, points, updated_at)
    values (
      p_user_id, v_team, v_iso_year, v_iso_week,
      coalesce((select sum(points) from public.fitness_score_events
                where user_id = p_user_id and team_id = v_team and event_date >= p_week_start and event_date < v_week_end), 0),
      now()
    )
    on conflict (user_id, team_id, iso_year, iso_week)
    do update set points = excluded.points, updated_at = now();
  end loop;
end;
$$;

-- 5. Count-based achievements the user no longer qualifies for are revoked
--    (together with their feed entry).
create or replace function public.revoke_stale_achievements(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int;
  v_seconds int;
  r record;
begin
  select count(*), coalesce(sum(duration_seconds), 0) into v_total, v_seconds
  from public.workouts where user_id = p_user_id and status = 'abgeschlossen';

  for r in
    select ua.id, a.code from public.user_achievements ua
    join public.achievements a on a.id = ua.achievement_id
    where ua.user_id = p_user_id
      and (
        (a.code = 'first_workout' and v_total < 1)
        or (a.code = 'ten_workouts' and v_total < 10)
        or (a.code = 'thousand_minutes' and v_seconds < 60000)
        or (a.code = 'weekly_goal_reached' and not exists (
              select 1 from public.fitness_score_events e where e.user_id = p_user_id and e.event_type = 'weekly_goal_reached'))
      )
  loop
    delete from public.user_achievements where id = r.id;
    delete from public.activity_feed
      where user_id = p_user_id and event_type = 'achievement_unlocked' and params ->> 'achievementCode' = r.code;
  end loop;
end;
$$;

revoke all on function public.recompute_workout_scores(uuid, date) from public, anon, authenticated;
revoke all on function public.revoke_stale_achievements(uuid) from public, anon, authenticated;

-- 6. Public entry points. Ownership is enforced here (auth.uid()) — team
--    admins and creators get no special path.
create or replace function public.update_own_workout(
  p_workout_id uuid, p_title text, p_finished_at timestamptz, p_duration_seconds int, p_distance_km numeric, p_notes text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_w public.workouts%rowtype;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_minutes int;
  v_old_week date;
  v_new_week date;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into v_w from public.workouts where id = p_workout_id;
  if not found or v_w.user_id <> auth.uid() then raise exception 'not_owner' using errcode = '42501'; end if;
  if v_w.status <> 'abgeschlossen' then raise exception 'not_completed' using errcode = '22023'; end if;
  if p_duration_seconds is null or p_duration_seconds < 1 or p_duration_seconds > 86400
     or p_finished_at is null or p_finished_at > now() + interval '1 hour' then
    raise exception 'invalid_workout_data' using errcode = '22023';
  end if;

  v_old_week := date_trunc('week', v_w.finished_at)::date;
  v_new_week := date_trunc('week', p_finished_at)::date;
  v_minutes := round(p_duration_seconds / 60.0);

  update public.workouts
  set title = v_title,
      finished_at = p_finished_at,
      started_at = p_finished_at - make_interval(secs => p_duration_seconds),
      duration_seconds = p_duration_seconds,
      distance_km = p_distance_km,
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      scheduled_date = p_finished_at::date
  where id = p_workout_id;

  -- Keep the visible team event in sync (in place: no new message, no push,
  -- no unread change).
  update public.messages
  set metadata = metadata || jsonb_build_object('title', v_title)
                          || case when event_type = 'workout_completed' then jsonb_build_object('duration_minutes', v_minutes) else '{}'::jsonb end
  where workout_id = p_workout_id and message_type = 'system' and event_type in ('workout_started', 'workout_completed');

  update public.activity_feed
  set params = params || jsonb_build_object('durationMinutes', v_minutes)
  where workout_id = p_workout_id and event_type = 'workout_completed';

  perform public.recompute_workout_scores(v_w.user_id, v_old_week);
  if v_new_week <> v_old_week then
    perform public.recompute_workout_scores(v_w.user_id, v_new_week);
  end if;
  if v_w.team_id is not null then
    perform public.recompute_challenge_progress(v_w.user_id, v_w.team_id);
  end if;
  perform public.revoke_stale_achievements(v_w.user_id);

  insert into public.audit_events (team_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_w.team_id, auth.uid(), 'workout_edited', 'workout', p_workout_id, '{}'::jsonb);
end;
$$;

create or replace function public.delete_own_workout(p_workout_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_w public.workouts%rowtype;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into v_w from public.workouts where id = p_workout_id;
  if not found or v_w.user_id <> auth.uid() then raise exception 'not_owner' using errcode = '42501'; end if;

  -- Flag the events first so open chats drop them live (realtime UPDATE); the
  -- cascade below then removes them together with their reactions, replies
  -- and personal notifications.
  update public.messages set deleted_at = now() where workout_id = p_workout_id and message_type = 'system';

  delete from public.workouts where id = p_workout_id;

  if v_w.finished_at is not null then
    perform public.recompute_workout_scores(v_w.user_id, date_trunc('week', v_w.finished_at)::date);
  end if;
  if v_w.team_id is not null then
    perform public.recompute_challenge_progress(v_w.user_id, v_w.team_id);
  end if;
  perform public.revoke_stale_achievements(v_w.user_id);

  insert into public.audit_events (team_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_w.team_id, auth.uid(), 'workout_deleted', 'workout', p_workout_id, '{}'::jsonb);
end;
$$;

revoke all on function public.update_own_workout(uuid, text, timestamptz, int, numeric, text) from public, anon;
revoke all on function public.delete_own_workout(uuid) from public, anon;
grant execute on function public.update_own_workout(uuid, text, timestamptz, int, numeric, text) to authenticated;
grant execute on function public.delete_own_workout(uuid) to authenticated;
