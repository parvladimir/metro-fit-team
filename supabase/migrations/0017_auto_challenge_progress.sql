-- ---------------------------------------------------------------------------
-- Fix: challenge_participants.progress_value was never updated by real
-- activity — only a manual/seeded value. Discovered via manual testing:
-- completing a workout that should count toward the active "4 Trainings
-- diese Woche" challenge left its progress bar frozen. This recomputes
-- progress (authoritatively, from source data — not a blind increment, so
-- it stays correct even if workouts are edited/deleted later) for every
-- challenge the user already participates in whenever they complete a
-- workout or log step/distance activity.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_challenge_progress(p_user_id uuid, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge record;
  v_progress numeric;
begin
  for v_challenge in
    select c.* from public.challenges c
    join public.challenge_participants cp on cp.challenge_id = c.id and cp.user_id = p_user_id
    where c.team_id = p_team_id
      and c.starts_at <= current_date and c.ends_at >= current_date
      and cp.completed_at is null
  loop
    v_progress := case v_challenge.metric
      when 'workouts_count' then (
        select count(*) from public.workouts
        where user_id = p_user_id and status = 'abgeschlossen'
          and finished_at::date between v_challenge.starts_at and v_challenge.ends_at
      )
      when 'strength_sessions' then (
        select count(*) from public.workouts
        where user_id = p_user_id and status = 'abgeschlossen' and activity_type = 'krafttraining'
          and finished_at::date between v_challenge.starts_at and v_challenge.ends_at
      )
      when 'minutes' then (
        select coalesce(sum(duration_seconds), 0) / 60.0 from public.workouts
        where user_id = p_user_id and status = 'abgeschlossen'
          and finished_at::date between v_challenge.starts_at and v_challenge.ends_at
      )
      when 'distance_km' then (
        select coalesce(sum(distance_km), 0)
        from (
          select distance_km, finished_at::date as d from public.workouts
          where user_id = p_user_id and status = 'abgeschlossen' and distance_km is not null
          union all
          select distance_km, occurred_at::date from public.activities
          where user_id = p_user_id and distance_km is not null
        ) combined
        where d between v_challenge.starts_at and v_challenge.ends_at
      )
      when 'steps' then (
        select coalesce(sum(steps), 0) from public.activities
        where user_id = p_user_id and steps is not null
          and occurred_at::date between v_challenge.starts_at and v_challenge.ends_at
      )
      else null -- 'custom' metrics are never auto-computed
    end;

    if v_progress is not null then
      update public.challenge_participants
      set progress_value = v_progress
      where challenge_id = v_challenge.id and user_id = p_user_id;
    end if;
  end loop;
end;
$$;

-- Wire it into the existing workout-completion and step-goal triggers.
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
      insert into public.activity_feed (team_id, user_id, event_type, message_key, params)
      values (
        new.team_id, new.user_id, 'workout_completed', 'feed.workoutCompleted',
        jsonb_build_object('durationMinutes', round(coalesce(new.duration_seconds, 0) / 60.0))
      );
    end if;

    perform public.recompute_challenge_progress(new.user_id, new.team_id);
  end if;

  -- Achievements are personal and tracked regardless of team membership.
  select count(*) into v_total_completed from public.workouts where user_id = new.user_id and status = 'abgeschlossen';
  select coalesce(sum(duration_seconds), 0) into v_total_seconds from public.workouts where user_id = new.user_id and status = 'abgeschlossen';

  if v_total_completed = 1 then
    perform public.grant_achievement(new.user_id, 'first_workout', new.team_id);
  elsif v_total_completed = 10 then
    perform public.grant_achievement(new.user_id, 'ten_workouts', new.team_id);
  end if;

  if v_total_seconds >= 60000 then -- 1000 minutes
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

create or replace function public.handle_activity_step_goal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_goal int;
  v_rules public.team_ranking_rules%rowtype;
begin
  if new.team_id is not null then
    perform public.recompute_challenge_progress(new.user_id, new.team_id);
  end if;

  if new.steps is null or new.team_id is null then
    return new;
  end if;

  select steps_goal into v_goal from public.user_metric_preferences where user_id = new.user_id;

  if new.steps >= coalesce(v_goal, 10000) then
    select * into v_rules from public.team_ranking_rules where team_id = new.team_id;
    perform public.award_fitness_score(
      new.user_id, new.team_id, 'daily_step_goal',
      coalesce(v_rules.points_daily_step_goal, 20), new.occurred_at::date, null, '{}'::jsonb
    );
  end if;

  return new;
end;
$$;
