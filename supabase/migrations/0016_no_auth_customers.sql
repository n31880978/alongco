-- AlongCo — 0016_no_auth_customers.sql
--
-- Remove all customer-session coupling. There is no customer login.
-- The booking IS the identity. Reference AC-XXXXXX is the access token.
--
-- All changes are idempotent (IF EXISTS / IF NOT EXISTS) so this file can be
-- re-run safely against a partially-applied state.
--
-- Run order matters within this file: schema first, then RPCs, then grants.
-- ============================================================================


-- ============================================================================
-- 1. customers TABLE CHANGES
-- ============================================================================

-- auth_user_id: make nullable. New bookings arrive with no Supabase session.
-- (0001 declared it NOT NULL; 0011 added email but left this constraint.)
alter table customers
  alter column auth_user_id drop not null;

-- Drop old partial unique index on auth_user_id (no-op if absent).
drop index if exists idx_customers_auth_user_id;

-- Recreate as a partial index: uniqueness only where the value is non-null.
-- Legacy/admin rows (old Clerk rows) keep their uniqueness guarantee;
-- new no-auth rows all have null and are excluded.
create unique index if not exists idx_customers_auth_user_id
  on customers (auth_user_id)
  where auth_user_id is not null;

-- Drop the case-insensitive unique constraint on email that 0011 created.
-- Same person booking twice → new customer row is fine; the booking IS the
-- identity. Admin email search still works via the plain index below.
drop index if exists customers_email_key;
drop index if exists idx_customers_email_lower;

-- Plain (non-unique) index for admin email lookups and the lookup RPC.
create index if not exists idx_customers_email
  on customers (lower(email));

-- Add preferences and meeting_notes collected from the booking form.
alter table customers
  add column if not exists preferences   text,
  add column if not exists meeting_notes text;

-- phone: was NOT NULL in 0001; relaxed in 0011. Make sure it stays nullable
-- so the column does not reject the insert path in create_booking_hold.
alter table customers
  alter column phone drop not null;

-- Drop the unique constraint on phone that 0001 created.
-- Same person can book again under the same number; that is fine.
alter table customers drop constraint if exists customers_phone_key;


-- ============================================================================
-- 2. DROP OLD AUTH-DEPENDENT RLS POLICIES
--    All customer reads now go through service-role or security-definer RPCs.
--    Public catalogue policies (companions, areas, reviews, settings) are kept.
-- ============================================================================

drop policy if exists customers_select_own      on customers;
drop policy if exists bookings_select_own       on bookings;
drop policy if exists booking_events_select_own on booking_events;
drop policy if exists reviews_select_own        on reviews;
drop policy if exists reviews_insert_own        on reviews;


-- ============================================================================
-- 3. DROP DEAD FUNCTIONS (never called in no-auth model, or superseded below)
-- ============================================================================

-- ac_set_booking_details: no longer exists — details now go through the hold.
-- Drop every signature that may exist from 0005, 0011.
drop function if exists ac_set_booking_details(uuid, text, uuid, text);
drop function if exists ac_set_booking_details(uuid, text, text, uuid, text);

-- ac_cancel_own_booking and ac_quote_own_cancellation: customer self-cancel
-- flow was never shipped in the no-auth model; ticket page links to a route
-- that does not exist. Keep the RPCs in DB for now but revoke public grant.
revoke execute on function ac_cancel_own_booking(uuid, text)
  from anon, authenticated;
revoke execute on function ac_quote_own_cancellation(uuid)
  from anon, authenticated;

-- ac_ensure_customer and ac_set_customer_profile: only made sense when the
-- customer had a Supabase session. No callers remain.
revoke execute on function ac_ensure_customer(text)
  from anon, authenticated;
revoke execute on function ac_set_customer_profile(text)
  from anon, authenticated;

-- Remove the old 6-param create_booking_hold signature if still present.
drop function if exists create_booking_hold(text, timestamptz, integer, uuid, text, text);


-- ============================================================================
-- 4. create_booking_hold — REWRITTEN
--
-- Accepts customer details directly from the booking form.
-- Upserts the customer by email (no session, no JWT).
-- Creates the booking hold in a single atomic transaction.
-- Callable by anon — no login required.
-- ============================================================================

create or replace function create_booking_hold(
  p_companion_slug   text,
  p_starts_at        timestamptz,
  p_duration_minutes integer,
  p_area_id          uuid,
  p_terms_version    text,
  -- Customer identity — collected from the slot-picker form
  p_full_name        text,
  p_email            text,
  p_phone            text,
  p_preferences      text default null,
  p_customer_notes   text default null
)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_customer     customers%rowtype;
  v_companion    companions%rowtype;
  v_tz           text;
  v_window_days  integer;
  v_buffer       integer;
  v_hold_minutes integer;
  v_min_minutes  integer;
  v_hours        jsonb;
  v_terms        text;
  v_ends_at      timestamptz;
  v_local_start  timestamp;
  v_local_end    timestamp;
  v_weekday      smallint;
  v_amount       integer;
  v_discount     smallint;
  v_existing     bookings%rowtype;
  v_id           uuid;
  v_reference    text;
  v_hold_expires timestamptz;
  v_email_norm   text;
  v_name         text;
  v_phone_norm   text;
begin
  -- ---- Input normalisation ------------------------------------------------
  v_email_norm := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_name       := nullif(btrim(coalesce(p_full_name, '')), '');
  v_phone_norm := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');

  if v_email_norm is null then
    raise exception 'AC_EMAIL_REQUIRED';
  end if;
  -- Basic format guard — the JS layer validates fully; this is a last defence.
  if v_email_norm !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'AC_EMAIL_INVALID';
  end if;
  if v_name is null or length(v_name) < 2 then
    raise exception 'AC_NAME_REQUIRED';
  end if;

  -- Normalise phone to 12-digit Indian format (91XXXXXXXXXX).
  if length(v_phone_norm) = 10 then
    v_phone_norm := '91' || v_phone_norm;
  end if;
  if v_phone_norm !~ '^91[6-9][0-9]{9}$' then
    raise exception 'AC_PHONE_INVALID';
  end if;

  -- ---- Customer upsert by email -------------------------------------------
  -- Same email = same person; update their current name and phone so the
  -- confirmation queue always shows fresh details.
  select * into v_customer
    from customers
   where lower(email) = v_email_norm
   limit 1;

  if found then
    update customers
       set full_name   = v_name,
           phone       = v_phone_norm,
           -- Only overwrite preferences if the new booking supplied something.
           preferences = coalesce(
                           nullif(btrim(coalesce(p_preferences, '')), ''),
                           preferences
                         ),
           email       = v_email_norm      -- normalise case on every booking
     where id = v_customer.id
    returning * into v_customer;
  else
    insert into customers (
      email, full_name, phone, preferences,
      consent_version, consent_at
    ) values (
      v_email_norm,
      v_name,
      v_phone_norm,
      nullif(btrim(coalesce(p_preferences, '')), ''),
      -- Record terms acceptance as consent, consistent with PRD §3.8.
      p_terms_version,
      now()
    )
    returning * into v_customer;
  end if;

  if v_customer.is_blocked then
    raise exception 'AC_BOOKING_REFUSED';
  end if;

  -- ---- Companion validation -----------------------------------------------
  select * into v_companion from companions where slug = p_companion_slug;
  if not found or not v_companion.is_active then
    raise exception 'AC_COMPANION_UNAVAILABLE';
  end if;
  if not v_companion.is_accepting then
    raise exception 'AC_COMPANION_PAUSED';
  end if;

  -- ---- Settings (single pass) ---------------------------------------------
  v_tz           := coalesce(ac_setting('timezone') #>> '{}', 'Asia/Kolkata');
  v_window_days  := ac_setting_int('booking_window_days', 7);
  v_buffer       := ac_setting_int('buffer_minutes', 15);
  v_hold_minutes := ac_setting_int('hold_minutes', 10);
  v_min_minutes  := ac_setting_int('min_duration_minutes', 60);
  v_hours        := ac_setting('service_hours');
  v_terms        := ac_setting('terms_version') #>> '{}';

  if p_terms_version is null or p_terms_version is distinct from v_terms then
    raise exception 'AC_TERMS_STALE';
  end if;
  if p_duration_minutes < v_min_minutes then
    raise exception 'AC_DURATION_TOO_SHORT';
  end if;
  if p_duration_minutes % 30 <> 0 then
    raise exception 'AC_DURATION_INVALID';
  end if;

  -- ---- Time validation ----------------------------------------------------
  v_ends_at := p_starts_at + make_interval(mins => p_duration_minutes);

  if p_starts_at < now() then
    raise exception 'AC_SLOT_IN_PAST';
  end if;
  if p_starts_at > now() + make_interval(days => v_window_days) then
    raise exception 'AC_OUTSIDE_WINDOW';
  end if;

  -- Service hours are wall-clock IST, so compare in local time.
  v_local_start := p_starts_at at time zone v_tz;
  v_local_end   := v_ends_at   at time zone v_tz;
  v_weekday     := extract(dow from v_local_start)::smallint;

  if v_local_start::time < (v_hours ->> 'start')::time
     or v_local_end::time > (v_hours ->> 'end')::time
     or v_local_end::date <> v_local_start::date then
    raise exception 'AC_OUTSIDE_SERVICE_HOURS';
  end if;

  -- ---- Area & availability ------------------------------------------------
  if not exists (
    select 1 from companion_areas ca
      join areas a on a.id = ca.area_id
     where ca.companion_id = v_companion.id
       and ca.area_id = p_area_id
       and a.is_active
  ) then
    raise exception 'AC_AREA_UNAVAILABLE';
  end if;

  if not exists (
    select 1 from companion_availability av
     where av.companion_id = v_companion.id
       and av.weekday      = v_weekday
       and av.start_time  <= v_local_start::time
       and av.end_time    >= v_local_end::time
  ) then
    raise exception 'AC_NOT_WORKING';
  end if;

  if exists (
    select 1 from companion_blackouts b
     where b.companion_id = v_companion.id
       and b.starts_at    < v_ends_at
       and b.ends_at      > p_starts_at
  ) then
    raise exception 'AC_SLOT_TAKEN';
  end if;

  -- ---- Resume an existing live hold for the same slot --------------------
  -- Payment retry must reuse the same booking, not create a duplicate. §6.6
  select * into v_existing
    from bookings
   where customer_id     = v_customer.id
     and companion_id    = v_companion.id
     and starts_at       = p_starts_at
     and status          = 'pending_payment'
     and hold_expires_at > now()
   limit 1;

  if found then
    return jsonb_build_object(
      'booking_id',      v_existing.id,
      'reference',       v_existing.reference,
      'amount_paise',    v_existing.amount_paise,
      'hold_expires_at', v_existing.hold_expires_at,
      'resumed',         true,
      'customer_id',     v_customer.id
    );
  end if;

  -- ---- Price (server-computed, never supplied by caller) -----------------
  select q.amount_paise, q.discount_percent
    into v_amount, v_discount
    from ac_quote(v_companion.hourly_rate_paise, p_duration_minutes) q;

  v_reference    := ac_generate_reference();
  v_hold_expires := now() + make_interval(mins => v_hold_minutes);

  -- ---- Insert, catching a race on the GiST exclusion constraint ----------
  begin
    insert into bookings (
      reference, customer_id, companion_id, area_id,
      starts_at, ends_at, buffer_minutes,
      status, hold_expires_at,
      amount_paise, rate_snapshot_paise, discount_percent,
      terms_version, terms_accepted_at,
      customer_notes
    ) values (
      v_reference, v_customer.id, v_companion.id, p_area_id,
      p_starts_at, v_ends_at, v_buffer,
      'pending_payment', v_hold_expires,
      v_amount, v_companion.hourly_rate_paise, v_discount,
      p_terms_version, now(),
      nullif(btrim(coalesce(p_customer_notes, '')), '')
    )
    returning id into v_id;
  exception
    when exclusion_violation then
      -- Someone else's hold beat us. §3.5 — DB says no.
      raise exception 'AC_SLOT_TAKEN';
  end;

  insert into booking_events (
    booking_id, from_status, to_status, actor_type, actor_id, reason
  ) values (
    v_id, null, 'pending_payment', 'customer', v_customer.id, 'hold created'
  );

  return jsonb_build_object(
    'booking_id',      v_id,
    'reference',       v_reference,
    'amount_paise',    v_amount,
    'hold_expires_at', v_hold_expires,
    'resumed',         false,
    'customer_id',     v_customer.id
  );
end;
$$;


-- ============================================================================
-- 5. get_booking_by_reference — service-side read, no auth required.
--    The reference IS the access token. Used by ticket, pay, and review pages.
-- ============================================================================

create or replace function get_booking_by_reference(p_reference text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_booking   bookings%rowtype;
  v_customer  customers%rowtype;
  v_companion companions%rowtype;
  v_area      areas%rowtype;
  v_payment   payments%rowtype;
begin
  select * into v_booking
    from bookings
   where reference = upper(btrim(p_reference));
  if not found then
    return null;
  end if;

  select * into v_customer  from customers  where id = v_booking.customer_id;
  select * into v_companion from companions where id = v_booking.companion_id;
  select * into v_area      from areas      where id = v_booking.area_id;

  -- The captured/refunded payment gives us the method label on the ticket.
  select * into v_payment
    from payments
   where booking_id = v_booking.id
     and status in ('captured', 'partially_refunded', 'refunded')
   order by captured_at desc nulls last
   limit 1;

  return jsonb_build_object(
    'id',                   v_booking.id,
    'reference',            v_booking.reference,
    'status',               v_booking.status,
    'starts_at',            v_booking.starts_at,
    'ends_at',              v_booking.ends_at,
    'amount_paise',         v_booking.amount_paise,
    'rate_snapshot_paise',  v_booking.rate_snapshot_paise,
    'discount_percent',     v_booking.discount_percent,
    'hold_expires_at',      v_booking.hold_expires_at,
    'terms_version',        v_booking.terms_version,
    'terms_accepted_at',    v_booking.terms_accepted_at,
    'customer_notes',       v_booking.customer_notes,
    'area_id',              v_booking.area_id,
    'area_name',            v_area.name,
    'companion_id',         v_companion.id,
    'companion_slug',       v_companion.slug,
    'companion_name',       v_companion.display_name,
    'companion_photo_path', v_companion.photo_path,
    'confirmed_at',         v_booking.confirmed_at,
    'cancelled_at',         v_booking.cancelled_at,
    'refund_tier_applied',  v_booking.refund_tier_applied,
    'payment_method',       v_payment.method,
    -- Customer details — used for ticket display and Razorpay prefill.
    -- First name only is shown to the companion; full name stays internal.
    'customer_full_name',   v_customer.full_name,
    'customer_email',       v_customer.email,
    'customer_phone',       v_customer.phone
  );
end;
$$;


-- ============================================================================
-- 6. list_bookings_by_email — email-based booking lookup (no login needed).
--    Returns summary rows for a given email. Expired holds excluded.
-- ============================================================================

create or replace function list_bookings_by_email(p_email text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(btrim(p_email), ''));
begin
  if v_email is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id',             b.id,
        'reference',      b.reference,
        'status',         b.status,
        'starts_at',      b.starts_at,
        'ends_at',        b.ends_at,
        'amount_paise',   b.amount_paise,
        'area_name',      a.name,
        'companion_name', c.display_name,
        'companion_slug', c.slug
      )
      order by b.starts_at desc
    )
    from bookings b
    join customers  cu on cu.id = b.customer_id
    join companions c  on c.id  = b.companion_id
    join areas      a  on a.id  = b.area_id
    where lower(cu.email) = v_email
      and b.status <> 'expired'
  ), '[]'::jsonb);
end;
$$;


-- ============================================================================
-- 7. GRANTS — revoke from public first, then grant only what is needed.
-- ============================================================================

-- create_booking_hold: callable by anon — no session required.
revoke execute on function
  create_booking_hold(text, timestamptz, integer, uuid, text, text, text, text, text, text)
  from public;
grant execute on function
  create_booking_hold(text, timestamptz, integer, uuid, text, text, text, text, text, text)
  to anon, authenticated, service_role;

-- get_booking_by_reference: reference is the token; anon can resolve it.
revoke execute on function get_booking_by_reference(text) from public;
grant  execute on function get_booking_by_reference(text)
  to anon, authenticated, service_role;

-- list_bookings_by_email: same — no session required.
revoke execute on function list_bookings_by_email(text) from public;
grant  execute on function list_bookings_by_email(text)
  to anon, authenticated, service_role;

-- Cron endpoints remain service_role only (called from /api/cron/*).
-- get_availability_inputs stays anon-callable (public slot picker).
-- ac_admin_cancel_booking stays service_role only.
-- No changes needed to those grants.
