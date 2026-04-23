-- Setup media bucket for avatars and other uploads
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

-- Set up RLS for the media bucket
-- Note: 'storage.objects' is where the actual files reside

-- Allow anyone to read from the public 'media' bucket
create policy "Media is publicly accessible"
on storage.objects for select
using (bucket_id = 'media');

-- Allow authenticated users to upload files to their own avatars folder:
-- Folder structure: avatars/<user_id>/<filename>
create policy "Users can upload their own avatars"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'media' and
  (storage.foldername(name))[1] = 'avatars' and
  (storage.foldername(name))[2] = (select auth.uid()::text)
);


-- Allow org admins and super-admin override to manage organization avatars.
-- Folder structure: organizations/<organization_id>/<filename>
-- Allow users to update their own avatars
create policy "Users can update their own avatars"
on storage.objects for update
to authenticated
using (
  bucket_id = 'media' and
  (storage.foldername(name))[1] = 'avatars' and
  (storage.foldername(name))[2] = (select auth.uid()::text)
);

-- Allow users to delete their own avatars
create policy "Users can delete their own avatars"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'media' and
  (storage.foldername(name))[1] = 'avatars' and
  (storage.foldername(name))[2] = (select auth.uid()::text)
);

create policy "Users can insert organization avatars"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'media' and
  (storage.foldername(name))[1] = 'organizations' and
  exists (
    select 1
    from public.organizations o
    where o.id = (storage.foldername(storage.objects.name))[2]
      and (
        public.auth_current_user_has_critical_capability('platform.admin.override')
        or public.auth_user_is_org_admin(o.id, (select auth.uid()))
      )
  )
);

create policy "Users can update organization avatars"
on storage.objects for update
to authenticated
using (
  bucket_id = 'media' and
  (storage.foldername(name))[1] = 'organizations' and
  exists (
    select 1
    from public.organizations o
    where o.id = (storage.foldername(storage.objects.name))[2]
      and (
        public.auth_current_user_has_critical_capability('platform.admin.override')
        or public.auth_user_is_org_admin(o.id, (select auth.uid()))
      )
  )
)
with check (
  bucket_id = 'media' and
  (storage.foldername(name))[1] = 'organizations' and
  exists (
    select 1
    from public.organizations o
    where o.id = (storage.foldername(storage.objects.name))[2]
      and (
        public.auth_current_user_has_critical_capability('platform.admin.override')
        or public.auth_user_is_org_admin(o.id, (select auth.uid()))
      )
  )
);

create policy "Users can delete organization avatars"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'media' and
  (storage.foldername(name))[1] = 'organizations' and
  exists (
    select 1
    from public.organizations o
    where o.id = (storage.foldername(storage.objects.name))[2]
      and (
        public.auth_current_user_has_critical_capability('platform.admin.override')
        or public.auth_user_is_org_admin(o.id, (select auth.uid()))
      )
  )
);

-- Allow active-space admins, org admins of the owning organization, and
-- super-admin override to manage space avatars.
-- Folder structure: spaces/<space_id>/avatar/<filename>
create policy "Users can insert space avatars"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'media' and
  (storage.foldername(name))[1] = 'spaces' and
  (storage.foldername(name))[3] = 'avatar' and
  exists (
    select 1
    from public.spaces s
    where s.id = (storage.foldername(storage.objects.name))[2]
      and (
        public.auth_current_user_has_critical_capability('platform.admin.override')
        or public.auth_user_is_org_admin(s.organization_id, (select auth.uid()))
        or public.auth_user_is_space_admin(s.id, (select auth.uid()))
      )
  )
);

create policy "Users can update space avatars"
on storage.objects for update
to authenticated
using (
  bucket_id = 'media' and
  (storage.foldername(name))[1] = 'spaces' and
  (storage.foldername(name))[3] = 'avatar' and
  exists (
    select 1
    from public.spaces s
    where s.id = (storage.foldername(storage.objects.name))[2]
      and (
        public.auth_current_user_has_critical_capability('platform.admin.override')
        or public.auth_user_is_org_admin(s.organization_id, (select auth.uid()))
        or public.auth_user_is_space_admin(s.id, (select auth.uid()))
      )
  )
)
with check (
  bucket_id = 'media' and
  (storage.foldername(name))[1] = 'spaces' and
  (storage.foldername(name))[3] = 'avatar' and
  exists (
    select 1
    from public.spaces s
    where s.id = (storage.foldername(storage.objects.name))[2]
      and (
        public.auth_current_user_has_critical_capability('platform.admin.override')
        or public.auth_user_is_org_admin(s.organization_id, (select auth.uid()))
        or public.auth_user_is_space_admin(s.id, (select auth.uid()))
      )
  )
);

create policy "Users can delete space avatars"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'media' and
  (storage.foldername(name))[1] = 'spaces' and
  (storage.foldername(name))[3] = 'avatar' and
  exists (
    select 1
    from public.spaces s
    where s.id = (storage.foldername(storage.objects.name))[2]
      and (
        public.auth_current_user_has_critical_capability('platform.admin.override')
        or public.auth_user_is_org_admin(s.organization_id, (select auth.uid()))
        or public.auth_user_is_space_admin(s.id, (select auth.uid()))
      )
  )
);

-- For Author App Media uploads:
-- Folder structure: spaces/<space_id>/author/<filename>
-- Keep the object path aligned with the active Product Space boundary.
create policy "Users can insert author media"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'media' and
  (storage.foldername(name))[1] = 'spaces' and
  (storage.foldername(name))[3] = 'author' and
  public.auth_user_can_access_in_space(
    (storage.foldername(name))[2],
    'space.content.create'
  )
);

create policy "Users can update author media"
on storage.objects for update
to authenticated
using (
  bucket_id = 'media' and
  (storage.foldername(name))[1] = 'spaces' and
  (storage.foldername(name))[3] = 'author' and
  public.auth_user_can_access_in_space(
    (storage.foldername(name))[2],
    'space.content.update'
  )
);

create policy "Users can delete author media"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'media' and
  (storage.foldername(name))[1] = 'spaces' and
  (storage.foldername(name))[3] = 'author' and
  public.auth_user_can_access_in_space(
    (storage.foldername(name))[2],
    'space.content.delete'
  )
);
