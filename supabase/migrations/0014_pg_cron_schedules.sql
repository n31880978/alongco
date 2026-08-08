-- AlongCo — 0014_pg_cron_schedules.sql
--
-- Scheduling moves into Postgres. CLAUDE.md §8 named Vercel Cron; this replaces
-- it, and the reason is not preference — the HTTP approach could not be made to
-- work on the plan this project is on:
--
--   · Vercel Cron on Hobby is capped at one invocation per day. expire-holds
--     has to run every minute, because a hold lasts ten. Daily means a slot can
--     sit wrongly held for most of a day, which fails the PRD §6.4 criterion
--     outright ("an 11-minute-old hold is expired and its slot is bookable
--     again").
--   · The GitHub Actions fallback failed every run: it called the apex, which
--     308-redirects to www, and CRON_SECRET was never added to the repo secrets
--     so the bearer token was empty and the route answered 401. Two separate
--     faults, both invisible until someone read the failure emails.
--
-- pg_cron removes the whole class of problem. Both jobs are already single SQL
-- function calls, so there is nothing for HTTP to add:
--
--   · no hostname to get wrong, and no redirect to follow
--   · no shared secret to set in two places and keep in step
--   · no hosting plan limit — this is Postgres, not the web tier
--   · no coupling to the host at all, so moving off Vercel changes nothing
--
-- The /api/cron/* routes stay. They are still the way to trigger a run by hand
-- when investigating something, and they still verify CRON_SECRET.

-- ---------------------------------------------------------------------------
-- Scheduling, guarded.
--
-- pg_cron ships with Supabase but not with a plain local Postgres, and the test
-- database is a plain local Postgres (scripts/db-reset.sh). Skipping when the
-- extension is unavailable keeps `npm run db:reset` working — the same shape
-- 0004_storage.sql uses for the storage schema. The scheduled work itself is
-- tested directly by calling ac_expire_holds() and ac_complete_bookings(), so
-- nothing goes unverified because of the skip.
--
-- Unscheduling first makes this safe to re-run on any pg_cron version and
-- leaves no chance of a stale duplicate under a slightly different name.
-- ---------------------------------------------------------------------------

do $$
declare
  j text;
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron unavailable — skipping schedule setup (expected on a plain local Postgres)';
    return;
  end if;

  create extension if not exists pg_cron;

  foreach j in array array['ac-expire-holds', 'ac-complete-bookings']
  loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(j);
    end if;
  end loop;

  -- Every minute: pending_payment past hold_expires_at -> expired, which
  -- returns the slot to availability. ac_expire_holds() uses FOR UPDATE SKIP
  -- LOCKED, so an overrun run cannot expire the same booking twice.
  perform cron.schedule(
    'ac-expire-holds',
    '* * * * *',
    'select public.ac_expire_holds();'
  );

  -- Hourly, on the hour: confirmed bookings past ends_at -> completed. This is
  -- what makes a booking reviewable (PRD §6.10).
  perform cron.schedule(
    'ac-complete-bookings',
    '0 * * * *',
    'select public.ac_complete_bookings();'
  );
end
$$;
