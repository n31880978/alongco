-- =============================================================================
-- AlongCo — 08_cron.sql
--
-- pg_cron schedules for the two background workers.
-- Guarded: pg_cron ships with Supabase but not with a plain local Postgres.
-- The guard keeps `npm run db:reset` working — the functions themselves are
-- tested directly in the test suite.
-- =============================================================================

do $$
declare
  j text;
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron unavailable — skipping schedule setup (expected on plain Postgres)';
    return;
  end if;

  create extension if not exists pg_cron;

  -- Unschedule first so this file is safe to re-apply on any pg_cron version
  -- and leaves no stale duplicate jobs under a slightly different name.
  foreach j in array array['ac-expire-holds', 'ac-complete-bookings']
  loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(j);
    end if;
  end loop;

  -- Every minute: pending_payment holds past hold_expires_at → expired.
  -- FOR UPDATE SKIP LOCKED in ac_expire_holds() means an overrun run cannot
  -- expire the same booking twice.
  perform cron.schedule(
    'ac-expire-holds',
    '* * * * *',
    'select public.ac_expire_holds();'
  );

  -- Hourly on the hour: confirmed bookings past ends_at → completed.
  -- This is what makes a booking reviewable (PRD §6.10).
  perform cron.schedule(
    'ac-complete-bookings',
    '0 * * * *',
    'select public.ac_complete_bookings();'
  );
end
$$;
