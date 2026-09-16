-- ---------------------------------------------------------------------------
-- Global exercise catalogue (team_id = null → visible to every team).
-- Safe to run repeatedly: exercises are matched by name for idempotency.
-- Demo USERS/teams/workouts are seeded separately via `npm run seed`
-- (scripts/seed.ts), because creating Supabase Auth users requires the
-- Admin API, not raw SQL.
-- ---------------------------------------------------------------------------
insert into public.exercises (name, muscle_group, equipment, exercise_type, default_sets, default_reps, instructions)
select * from (values
  ('Bankdrücken', 'chest', 'Langhantel', 'strength', 4, 8, 'Langhantel kontrolliert zur Brust senken, kraftvoll nach oben drücken.'),
  ('Schrägbankdrücken Kurzhantel', 'chest', 'Kurzhanteln', 'strength', 3, 10, null),
  ('Liegestütze', 'chest', 'Körpergewicht', 'strength', 3, 15, null),
  ('Butterfly', 'chest', 'Maschine', 'strength', 3, 12, null),
  ('Klimmzüge', 'back', 'Klimmzugstange', 'strength', 4, 8, null),
  ('Latzug', 'back', 'Kabelzug', 'strength', 3, 10, null),
  ('Rudern vorgebeugt', 'back', 'Langhantel', 'strength', 4, 10, null),
  ('Kreuzheben', 'back', 'Langhantel', 'strength', 4, 6, 'Rücken gerade halten, aus der Hüfte heben.'),
  ('Kniebeugen', 'legs', 'Langhantel', 'strength', 4, 8, 'Knie in Richtung Zehenspitzen, Rücken neutral.'),
  ('Beinpresse', 'legs', 'Maschine', 'strength', 3, 12, null),
  ('Ausfallschritte', 'legs', 'Kurzhanteln', 'strength', 3, 12, null),
  ('Beinstrecker', 'legs', 'Maschine', 'strength', 3, 15, null),
  ('Beinbeuger', 'legs', 'Maschine', 'strength', 3, 15, null),
  ('Wadenheben', 'legs', 'Maschine', 'strength', 3, 15, null),
  ('Schulterdrücken', 'shoulders', 'Kurzhanteln', 'strength', 3, 10, null),
  ('Seitheben', 'shoulders', 'Kurzhanteln', 'strength', 3, 15, null),
  ('Face Pulls', 'shoulders', 'Kabelzug', 'strength', 3, 15, null),
  ('Bizepscurls', 'biceps', 'Kurzhanteln', 'strength', 3, 12, null),
  ('Konzentrationscurls', 'biceps', 'Kurzhantel', 'strength', 3, 12, null),
  ('Trizepsdrücken Kabel', 'triceps', 'Kabelzug', 'strength', 3, 12, null),
  ('Dips', 'triceps', 'Barren', 'strength', 3, 10, null),
  ('Crunches', 'abs', 'Körpergewicht', 'strength', 3, 20, null),
  ('Plank', 'abs', 'Körpergewicht', 'strength', 3, 1, 'Position 45–60 Sekunden halten.'),
  ('Beinheben hängend', 'abs', 'Klimmzugstange', 'strength', 3, 12, null),
  ('Burpees', 'full_body', 'Körpergewicht', 'strength', 3, 12, null),
  ('Kettlebell Swings', 'full_body', 'Kettlebell', 'strength', 3, 15, null),
  ('Laufband', 'cardio', 'Laufband', 'cardio', 1, 1, null),
  ('Rudergerät', 'cardio', 'Rudergerät', 'cardio', 1, 1, null),
  ('Radfahren (Ergometer)', 'cardio', 'Ergometer', 'cardio', 1, 1, null),
  ('Seilspringen', 'cardio', 'Springseil', 'cardio', 3, 1, null)
) as v(name, muscle_group, equipment, exercise_type, default_sets, default_reps, instructions)
where not exists (
  select 1 from public.exercises e where e.name = v.name and e.team_id is null
);
