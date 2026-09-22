-- ---------------------------------------------------------------------------
-- Sharing plan templates / configured days / completed workouts into team
-- chat, with an independent personal copy on import.
--
-- Deliberately reuses messages.message_type = 'text' rather than adding a new
-- type: the existing RLS/CHECK constraints on `messages` already accept a
-- plain text message with no attachment, so the entire new surface lives in
-- new, isolated tables instead of touching the chat pipeline that has broken
-- in the past. `messages.metadata` (already immutable via
-- guard_message_update) carries { plan_share_id } as a cheap hint for the
-- realtime client; the actual snapshot lives here.
--
-- All writes go through SECURITY DEFINER functions below (publish / withdraw
-- / import) — there are deliberately NO client insert/update/delete
-- policies, so a recipient can never alter a published snapshot and nobody
-- but the author can withdraw one.
-- ---------------------------------------------------------------------------

create table public.plan_shares (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references public.messages (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  source_type text not null check (source_type in ('template', 'workout')),
  -- Provenance only (on delete set null): the snapshot below never depends on
  -- these still existing, so a later edit/delete of the source never
  -- silently changes an already-published share.
  source_template_id uuid references public.plan_templates (id) on delete set null,
  source_plan_day_id uuid references public.workout_plan_days (id) on delete set null,
  source_workout_id uuid references public.workouts (id) on delete set null,
  title text not null check (char_length(title) between 1 and 60),
  -- Privacy defaults: both false unless the author explicitly opts in.
  share_weights boolean not null default false,
  share_instructions boolean not null default false,
  -- Optional workout summary — never per-set actual results.
  actual_duration_seconds integer check (actual_duration_seconds is null or actual_duration_seconds > 0),
  actual_distance_km numeric(6,2) check (actual_distance_km is null or actual_distance_km > 0),
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  check (source_type = 'workout' or source_workout_id is null),
  check (source_type = 'template' or (source_template_id is null and source_plan_day_id is null))
);

create index plan_shares_team_id_created_at_idx on public.plan_shares (team_id, created_at desc);

create table public.plan_share_items (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.plan_shares (id) on delete cascade,
  position smallint not null default 0,
  -- Bounded, allowlisted snapshot — never a full exercise/workout row.
  exercise_name text not null,
  exercise_type text not null check (exercise_type in (
    'strength', 'bodyweight', 'cardio_distance', 'cardio_time', 'interval', 'mobility', 'sport', 'other', 'cardio'
  )),
  muscle_group text not null check (muscle_group in (
    'chest', 'back', 'legs', 'shoulders', 'biceps', 'triceps', 'abs', 'full_body', 'cardio', 'other'
  )),
  equipment text,
  instructions text,
  -- Set only when safely reusable by any importer (a GLOBAL exercise, i.e.
  -- team_id is null and owner_user_id is null) — never a private or
  -- team-scoped exercise id, which another team's/user's RLS could deny.
  reusable_exercise_id uuid references public.exercises (id) on delete set null,
  target_sets smallint,
  target_reps smallint,
  target_weight_kg numeric(7,2) check (target_weight_kg is null or target_weight_kg >= 0),
  target_duration_seconds integer check (target_duration_seconds is null or target_duration_seconds > 0),
  target_distance_km numeric(7,2) check (target_distance_km is null or target_distance_km > 0),
  target_metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index plan_share_items_share_id_idx on public.plan_share_items (share_id);

-- Provenance per (share, recipient), for "Bereits gespeichert" and to allow
-- re-saving once a prior copy was deleted. template_id is nullable (set
-- null, not cascaded) so that history survives the recipient deleting their
-- copy — deliberately no unique constraint, since "Weitere Kopie erstellen"
-- must be able to add another row for the same (share, recipient).
create table public.plan_share_imports (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.plan_shares (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  template_id uuid references public.plan_templates (id) on delete set null,
  created_at timestamptz not null default now()
);

create index plan_share_imports_share_recipient_idx on public.plan_share_imports (share_id, recipient_id);

-- ---------------------------------------------------------------------------
-- RLS: select-only for current team members; every write happens inside a
-- SECURITY DEFINER function below, which enforces authorship/withdrawal
-- itself. A removed member loses select access the moment is_team_member()
-- stops matching — no separate "revoke" step needed.
-- ---------------------------------------------------------------------------
alter table public.plan_shares enable row level security;
alter table public.plan_share_items enable row level security;
alter table public.plan_share_imports enable row level security;

create policy "plan_shares_select_team" on public.plan_shares
  for select using (public.is_team_member(team_id));

create policy "plan_share_items_select_team" on public.plan_share_items
  for select using (
    exists (select 1 from public.plan_shares s where s.id = share_id and public.is_team_member(s.team_id))
  );

create policy "plan_share_imports_own_select" on public.plan_share_imports
  for select using (recipient_id = auth.uid());

-- ---------------------------------------------------------------------------
-- publish_plan_share: atomically creates the chat message + the publication
-- + its item snapshot. Exactly one of p_source_template_id /
-- p_source_plan_day_id / p_source_workout_id must be given, matching
-- source_type. Sharing weights/instructions is opt-in; a workout's actual
-- duration/distance summary is opt-in and separate from per-exercise
-- targets, which always come from the exercise's PLANNED snapshot, never
-- from logged results.
-- ---------------------------------------------------------------------------
create or replace function public.publish_plan_share(
  p_team_id uuid,
  p_source_type text,
  p_source_template_id uuid default null,
  p_source_plan_day_id uuid default null,
  p_source_workout_id uuid default null,
  p_title text default null,
  p_note text default null,
  p_share_weights boolean default false,
  p_share_instructions boolean default false,
  p_share_actual_summary boolean default false
)
returns table (message_id uuid, share_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_content text;
  v_message_id uuid := gen_random_uuid();
  v_share_id uuid;
  v_duration_seconds integer;
  v_distance_km numeric;
  v_item_count int;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.is_team_member(p_team_id) then raise exception 'not_a_team_member' using errcode = '42501'; end if;
  if p_source_type not in ('template', 'workout') then raise exception 'invalid_source_type' using errcode = '22023'; end if;

  if p_source_type = 'template' then
    if (p_source_template_id is not null) = (p_source_plan_day_id is not null) then
      raise exception 'invalid_source' using errcode = '22023';
    end if;
    if p_source_template_id is not null then
      if not exists (select 1 from public.plan_templates t where t.id = p_source_template_id and t.user_id = auth.uid()) then
        raise exception 'not_owner' using errcode = '42501';
      end if;
      select coalesce(nullif(btrim(coalesce(p_title, '')), ''), t.name)
        into v_title from public.plan_templates t where t.id = p_source_template_id;
    else
      if not exists (
        select 1 from public.workout_plan_days d join public.workout_plans p on p.id = d.plan_id
        where d.id = p_source_plan_day_id and p.user_id = auth.uid()
      ) then
        raise exception 'not_owner' using errcode = '42501';
      end if;
      select coalesce(nullif(btrim(coalesce(p_title, '')), ''), nullif(btrim(d.title), ''), 'Trainingsplan')
        into v_title from public.workout_plan_days d where d.id = p_source_plan_day_id;
    end if;
  else
    if p_source_workout_id is null then raise exception 'invalid_source' using errcode = '22023'; end if;
    if not exists (
      select 1 from public.workouts w where w.id = p_source_workout_id and w.user_id = auth.uid() and w.status = 'abgeschlossen'
    ) then
      raise exception 'not_owner_or_not_completed' using errcode = '42501';
    end if;
    select coalesce(nullif(btrim(coalesce(p_title, '')), ''), nullif(btrim(w.title), ''), 'Training')
      into v_title from public.workouts w where w.id = p_source_workout_id;
    if p_share_actual_summary then
      select w.duration_seconds, w.distance_km into v_duration_seconds, v_distance_km
      from public.workouts w where w.id = p_source_workout_id;
    end if;
  end if;

  v_title := left(v_title, 60);
  v_content := left(coalesce(nullif(btrim(coalesce(p_note, '')), ''), v_title), 2000);

  insert into public.messages (id, team_id, user_id, content, message_type, metadata)
  values (v_message_id, p_team_id, auth.uid(), v_content, 'text', '{}'::jsonb);

  insert into public.plan_shares (
    message_id, team_id, author_id, source_type, source_template_id, source_plan_day_id, source_workout_id,
    title, share_weights, share_instructions, actual_duration_seconds, actual_distance_km
  ) values (
    v_message_id, p_team_id, auth.uid(), p_source_type, p_source_template_id, p_source_plan_day_id, p_source_workout_id,
    v_title, coalesce(p_share_weights, false), coalesce(p_share_instructions, false), v_duration_seconds, v_distance_km
  ) returning id into v_share_id;

  update public.messages set metadata = jsonb_build_object('plan_share_id', v_share_id) where id = v_message_id;

  insert into public.plan_share_items (
    share_id, position, exercise_name, exercise_type, muscle_group, equipment, instructions,
    reusable_exercise_id, target_sets, target_reps, target_weight_kg, target_duration_seconds, target_distance_km, target_metrics
  )
  select
    v_share_id,
    (row_number() over (order by src.position))::smallint - 1,
    src.exercise_name, src.exercise_type, src.muscle_group, src.equipment,
    case when p_share_instructions then src.instructions else null end,
    case when src.owner_user_id is null and src.ex_team_id is null then src.exercise_id else null end,
    src.target_sets, src.target_reps,
    case when p_share_weights then src.target_weight_kg else null end,
    src.target_duration_seconds, src.target_distance_km, src.target_metrics
  from (
    -- from a saved template (exercise_name is i's own snapshot, so a
    -- previously-deleted exercise still yields a usable row)
    select
      i.position, i.exercise_name, coalesce(e.exercise_type, 'other') as exercise_type,
      coalesce(e.muscle_group, 'other') as muscle_group, e.equipment, e.instructions,
      e.owner_user_id, e.team_id as ex_team_id, i.exercise_id,
      i.target_sets, i.target_reps, i.target_weight_kg, i.target_duration_seconds, i.target_distance_km,
      coalesce(i.target_metrics, '{}'::jsonb) as target_metrics
    from public.plan_template_items i
    left join public.exercises e on e.id = i.exercise_id
    where p_source_template_id is not null and i.template_id = p_source_template_id

    union all
    -- from a live plan day not (yet) saved as a template
    select
      pe.position, e.name, e.exercise_type, e.muscle_group, e.equipment, e.instructions,
      e.owner_user_id, e.team_id, pe.exercise_id,
      pe.target_sets, pe.target_reps, pe.target_weight_kg, pe.target_duration_seconds, pe.target_distance_km,
      coalesce(pe.target_metrics, '{}'::jsonb)
    from public.workout_plan_exercises pe
    join public.exercises e on e.id = pe.exercise_id
    where p_source_plan_day_id is not null and pe.plan_day_id = p_source_plan_day_id

    union all
    -- from a completed workout: the PLANNED snapshot only — never the
    -- actually logged sets/weights/reps.
    select
      we.position, e.name, e.exercise_type, e.muscle_group, e.equipment, e.instructions,
      e.owner_user_id, e.team_id, we.exercise_id,
      (we.planned ->> 'sets')::smallint, (we.planned ->> 'reps')::smallint,
      (we.planned ->> 'weightKg')::numeric(7,2), (we.planned ->> 'durationSeconds')::integer,
      (we.planned ->> 'distanceKm')::numeric(7,2),
      jsonb_strip_nulls(jsonb_build_object(
        'rounds', (we.planned ->> 'rounds')::int,
        'work_seconds', (we.planned ->> 'workSeconds')::int,
        'rest_seconds', (we.planned ->> 'restSeconds')::int
      ))
    from public.workout_exercises we
    join public.exercises e on e.id = we.exercise_id
    where p_source_workout_id is not null and we.workout_id = p_source_workout_id
  ) as src(
    position, exercise_name, exercise_type, muscle_group, equipment, instructions, owner_user_id, ex_team_id,
    exercise_id, target_sets, target_reps, target_weight_kg, target_duration_seconds, target_distance_km, target_metrics
  );

  get diagnostics v_item_count = row_count;

  perform public.log_audit_event(
    p_team_id, auth.uid(), 'plan_share_published', 'plan_share', v_share_id,
    jsonb_build_object('source_type', p_source_type, 'item_count', v_item_count)
  );

  return query select v_message_id, v_share_id;
end;
$$;

grant execute on function public.publish_plan_share(uuid, text, uuid, uuid, uuid, text, text, boolean, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- withdraw_plan_share: author-only. Keeps the message/card in place — the
-- client renders a "Freigabe wurde zurückgezogen" placeholder instead of the
-- item list once withdrawn_at is set — but import_plan_share refuses from
-- this point on. Previously saved personal copies are entirely untouched.
-- ---------------------------------------------------------------------------
create or replace function public.withdraw_plan_share(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  update public.plan_shares set withdrawn_at = now()
  where id = p_share_id and author_id = auth.uid() and withdrawn_at is null
  returning team_id into v_team_id;

  if not found then raise exception 'not_owner_or_already_withdrawn' using errcode = '42501'; end if;

  perform public.log_audit_event(v_team_id, auth.uid(), 'plan_share_withdrawn', 'plan_share', p_share_id, '{}'::jsonb);
end;
$$;

grant execute on function public.withdraw_plan_share(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- import_plan_share: creates an INDEPENDENT personal plan_templates row
-- (never a reference back to the author's private rows). A private/deleted
-- exercise is recreated as a new recipient-owned custom exercise from the
-- allowlisted snapshot; a still-global exercise id is reused directly.
-- Idempotent by default (returns the existing live copy instead of a
-- duplicate); p_force_new_copy explicitly bypasses that for "Weitere Kopie
-- erstellen". Weight is double-gated: only present at all if the author
-- shared it, and even then stripped from THIS copy unless the recipient
-- opts in (default: stripped).
-- ---------------------------------------------------------------------------
create or replace function public.import_plan_share(
  p_share_id uuid,
  p_name text default null,
  p_keep_weights boolean default false,
  p_force_new_copy boolean default false
)
returns table (template_id uuid, already_imported boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share public.plan_shares%rowtype;
  v_existing uuid;
  v_template_id uuid;
  v_name text;
  v_item record;
  v_exercise_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_share from public.plan_shares where id = p_share_id;
  if not found then raise exception 'share_not_found' using errcode = 'P0002'; end if;
  if not public.is_team_member(v_share.team_id) then raise exception 'not_a_team_member' using errcode = '42501'; end if;
  if v_share.withdrawn_at is not null then raise exception 'share_withdrawn' using errcode = 'P0001'; end if;

  if not p_force_new_copy then
    select si.template_id into v_existing
    from public.plan_share_imports si
    join public.plan_templates t on t.id = si.template_id
    where si.share_id = p_share_id and si.recipient_id = auth.uid()
    order by si.created_at desc
    limit 1;
    if v_existing is not null then
      return query select v_existing, true;
      return;
    end if;
  end if;

  v_name := left(coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_share.title), 60);

  insert into public.plan_templates (user_id, name) values (auth.uid(), v_name) returning id into v_template_id;

  for v_item in select * from public.plan_share_items where share_id = p_share_id order by position loop
    v_exercise_id := v_item.reusable_exercise_id;
    if v_exercise_id is not null and not exists (select 1 from public.exercises where id = v_exercise_id) then
      v_exercise_id := null;
    end if;

    if v_exercise_id is null then
      insert into public.exercises (
        name, muscle_group, exercise_type, equipment, instructions,
        owner_user_id, is_custom, visibility, created_by, team_id
      ) values (
        v_item.exercise_name, v_item.muscle_group, v_item.exercise_type, v_item.equipment, v_item.instructions,
        auth.uid(), true, 'private', auth.uid(), null
      ) returning id into v_exercise_id;
    end if;

    insert into public.plan_template_items (
      template_id, exercise_id, exercise_name, position, target_sets, target_reps, target_weight_kg,
      target_duration_seconds, target_distance_km, target_metrics
    ) values (
      v_template_id, v_exercise_id, v_item.exercise_name, v_item.position, v_item.target_sets, v_item.target_reps,
      case when p_keep_weights then v_item.target_weight_kg else null end,
      v_item.target_duration_seconds, v_item.target_distance_km, v_item.target_metrics
    );
  end loop;

  insert into public.plan_share_imports (share_id, recipient_id, template_id) values (p_share_id, auth.uid(), v_template_id);

  perform public.log_audit_event(
    v_share.team_id, auth.uid(), 'plan_share_imported', 'plan_template', v_template_id,
    jsonb_build_object('share_id', p_share_id)
  );

  return query select v_template_id, false;
end;
$$;

grant execute on function public.import_plan_share(uuid, text, boolean, boolean) to authenticated;
