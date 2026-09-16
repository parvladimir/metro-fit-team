-- ---------------------------------------------------------------------------
-- Storage: avatars bucket. Each user may only read/write objects inside
-- their own folder (avatars/<user_id>/...), enforced via storage.objects RLS
-- keyed on the first path segment matching auth.uid().
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "avatars_owner_insert" on storage.objects
  for insert with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_owner_update" on storage.objects
  for update using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_owner_delete" on storage.objects
  for delete using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Storage: exercise-media bucket (instructional images/GIFs). Readable by
-- any authenticated user; writable only by team admins for their own team's
-- custom exercises. Kept simple: admins upload under exercise-media/<team_id>/.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('exercise-media', 'exercise-media', true)
on conflict (id) do nothing;

create policy "exercise_media_public_read" on storage.objects
  for select using (bucket_id = 'exercise-media');

create policy "exercise_media_admin_write" on storage.objects
  for insert with check (
    bucket_id = 'exercise-media'
    and public.is_team_admin(((storage.foldername(name))[1])::uuid)
  );
