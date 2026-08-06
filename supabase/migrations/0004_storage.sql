-- AlongCo — 0004_storage.sql
-- Supabase Storage buckets and their policies. Skipped by the local plain-Postgres
-- harness, which has no storage schema.

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema absent — skipping bucket setup';
    return;
  end if;

  -- Profile photos are meant to be seen. Public bucket, CDN-cacheable.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('companion-photos', 'companion-photos', true, 5242880,
          array['image/jpeg','image/png','image/webp'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- ID documents. Private, service_role only. CLAUDE.md §3.6 — no client policy
  -- is created for this bucket, deliberately.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('companion-docs', 'companion-docs', false, 10485760,
          array['image/jpeg','image/png','application/pdf'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
end
$$;

do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  drop policy if exists companion_photos_public_read on storage.objects;
  create policy companion_photos_public_read on storage.objects
    for select to anon, authenticated
    using (bucket_id = 'companion-photos');

  -- Uploads go through admin server actions on the service client, so there is
  -- no insert/update/delete policy for anon or authenticated on either bucket.
end
$$;
