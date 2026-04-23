-- Platform `profiles` is defined in repo migration:
-- `supabase/migrations/20260328210000_profiles.sql`
-- Do not recreate a legacy `profiles` shape here (it breaks the platform shell).

-- Set up Realtime
begin;
  drop publication if exists supabase_realtime;
  create publication supabase_realtime;
commit;

do $$
begin
  if to_regclass('public.profiles') is not null then
    execute 'alter publication supabase_realtime add table profiles';
  end if;
end $$;

-- Set up Storage (only if Storage schema migrations have created tables; seed runs before storage-api may run)
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name)
    values ('avatars', 'avatars')
    on conflict (id) do nothing;
  end if;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    create policy "Avatar images are publicly accessible."
      on storage.objects for select
      using (bucket_id = 'avatars');

    create policy "Anyone can upload an avatar."
      on storage.objects for insert
      with check (bucket_id = 'avatars');

    create policy "Anyone can update an avatar."
      on storage.objects for update
      using (bucket_id = 'avatars');
  end if;
end $$;
