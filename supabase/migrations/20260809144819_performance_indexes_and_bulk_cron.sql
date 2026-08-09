-- =============================================================================
-- Performance: indexes for high-concurrency paths + bulk cron functions
--
-- Context: target is 50–100 concurrent users on Vercel + Supabase Free/Pro.
-- This migration is safe to re-run (DROP IF EXISTS, CREATE OR REPLACE).
-- =============================================================================

-- Drop existing index if it exists (re-run safe)
drop index if exists idx_bookings_pending_customer;


-- ============================================================================
-- 1. Composite partial index for the hold-cap check in create_booking_hold
--
-- The function counts pending holds per customer:
--   SELECT count(*) FROM bookings
--    WHERE customer_id = ... AND status = 'pending_payment'
--      AND hold_expires_at > now()
--
-- The existing idx_bookings_pending_hold_expiry covers (hold_expires_at)
-- WHERE status = 'pending_payment' but does NOT include customer_id, so
-- Postgres has to scan all pending holds and filter. Adding customer_id
-- makes it a tiny index seek.
-- ============================================================================
create index idx_bookings_pending_customer
  on bookings (customer_id, hold_expires_at)
  where status = 'pending_payment';


-- ============================================================================
-- 2. Bulk-update cron functions — replace row-by-row PL/pgSQL loops with
--    set-based updates.
--
-- SKIP LOCKED semantics are preserved: concurrent cron invocations cannot
-- process the same booking twice.
-- ============================================================================

create or replace function ac_expire_holds()
returns integer
language plpgsql volatile
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  with expired as (
    select id
      from bookings
     where status = 'pending_payment'
       and hold_expires_at is not null
       and hold_expires_at < now()
     for update skip locked
  ),
  updated as (
    update bookings b
       set status = 'expired'
      from expired e
     where b.id = e.id
       and b.status = 'pending_payment'
    returning b.id
  )
  select array_agg(id) into v_ids from updated;

  if v_ids is null or array_length(v_ids, 1) = 0 then
    return 0;
  end if;

  insert into booking_events (booking_id, from_status, to_status, actor_type, actor_id, reason)
  select unnest(v_ids), 'pending_payment', 'expired', 'system', null,
         'hold lapsed before payment';

  return array_length(v_ids, 1);
end;
$$;

create or replace function ac_complete_bookings()
returns integer
language plpgsql volatile
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  with ended as (
    select id
      from bookings
     where status = 'confirmed'
       and ends_at < now()
     for update skip locked
  ),
  updated as (
    update bookings b
       set status       = 'completed',
           completed_at = coalesce(b.completed_at, now())
      from ended e
     where b.id = e.id
       and b.status = 'confirmed'
    returning b.id
  )
  select array_agg(id) into v_ids from updated;

  if v_ids is null or array_length(v_ids, 1) = 0 then
    return 0;
  end if;

  insert into booking_events (booking_id, from_status, to_status, actor_type, actor_id, reason)
  select unnest(v_ids), 'confirmed', 'completed', 'system', null,
         'end time passed';

  return array_length(v_ids, 1);
end;
$$;


-- ============================================================================
-- 3. CTE version of ac_set_booking_status — single round-trip for update+audit
-- ============================================================================

create or replace function ac_set_booking_status(
  p_booking_id uuid,
  p_to         booking_status,
  p_actor_type text,
  p_actor_id   uuid    default null,
  p_reason     text    default null
)
returns booking_status
language plpgsql volatile
set search_path = public
as $$
declare
  v_from booking_status;
begin
  select status into v_from
    from bookings
   where id = p_booking_id
   for update;

  if not found then
    raise exception 'AC_BOOKING_NOT_FOUND';
  end if;

  if v_from = p_to then
    return v_from;
  end if;

  with upd as (
    update bookings
       set status       = p_to,
           confirmed_at = case when p_to = 'confirmed'
                               then coalesce(confirmed_at, now()) else confirmed_at end,
           completed_at = case when p_to = 'completed'
                               then coalesce(completed_at, now()) else completed_at end
     where id = p_booking_id
    returning id
  )
  insert into booking_events (booking_id, from_status, to_status, actor_type, actor_id, reason)
  select p_booking_id, v_from, p_to, p_actor_type, p_actor_id, p_reason
    from upd;

  return v_from;
end;
$$;
