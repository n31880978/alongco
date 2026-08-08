-- =============================================================================
-- AlongCo — 06_storage.sql
--
-- Supabase Storage buckets and their access policies.
-- Wrapped in a guard: the storage schema is not present on a plain local
-- Postgres, so this file is silently skipped during test runs.
-- =============================================================================

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema absent — skipping bucket setup (expected on plain Postgres)';
    return;
  end if;

  -- ── companion-photos ────────────────────────────────────────────────────
  -- Profile photos are meant to be seen. Public bucket, CDN-cacheable.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'companion-photos', 'companion-photos', true,
    5242880,  -- 5 MB
    array['image/jpeg', 'image/png', 'image/webp']
  )
  on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- ── companion-docs ───────────────────────────────────────────────────────
  -- ID documents. Private, service_role only. No client policy is created
  -- for this bucket, deliberately.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'companion-docs', 'companion-docs', false,
    10485760,  -- 10 MB
    array['image/jpeg', 'image/png', 'application/pdf']
  )
  on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
end
$$;

do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  -- Anyone can read a companion photo — it is a public profile image.
  drop policy if exists companion_photos_public_read on storage.objects;
  create policy companion_photos_public_read on storage.objects
    for select to anon, authenticated
    using (bucket_id = 'companion-photos');

  -- Uploads go through admin server actions on the service client.
  -- No insert/update/delete policy for anon or authenticated on either bucket.
end
$$;
