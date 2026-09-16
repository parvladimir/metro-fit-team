-- ---------------------------------------------------------------------------
-- Workout completion → fitness score events, achievements, activity feed.
-- Fires only on the transition INTO 'abgeschlossen', so re-saving an already
-- completed workout never re-awards points.
-- ---------------------------------------------------------------------------
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

create trigger on_workout_status_change
  after update of status on public.workouts
  for each row execute function public.handle_workout_status_change();

-- ---------------------------------------------------------------------------
-- Daily step goal — awarded once per day when a logged activity's steps
-- reach the user's configured goal.
-- ---------------------------------------------------------------------------
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

create trigger on_activity_step_goal
  after insert or update of steps on public.activities
  for each row execute function public.handle_activity_step_goal();
