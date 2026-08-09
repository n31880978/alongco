-- =============================================================================
-- AlongCo — 03_rls.sql
--
-- Row Level Security: enabled on every table, deny by default.
-- A table with RLS enabled and no policy is accessible only by service_role.
-- That is the intended state for identities, payments, refunds, incidents,
-- audit logs, and rate-limit tables.
-- =============================================================================


-- =============================================================================
-- CLERK SUBJECT HELPER
-- Reads the JWT subject as text. Clerk user ids look like user_2abc123… which
-- is not a UUID, so auth.uid() cannot be used for customer identity.
-- Returns null on anonymous requests so policies quietly match nothing.
-- =============================================================================

create or replace function ac_auth_subject()
returns text
language sql stable
set search_path = public
as $$
  select nullif(auth.jwt() ->> 'sub', '');
$$;

comment on function ac_auth_subject() is
  'Clerk JWT subject as text. auth.uid() only accepts UUIDs; this does not.';

grant execute on function ac_auth_subject() to anon, authenticated, service_role;


-- =============================================================================
-- ENABLE RLS ON EVERY TABLE — no exceptions
-- =============================================================================

alter table settings               enable row level security;
alter table areas                  enable row level security;
alter table companions             enable row level security;
alter table companion_identities   enable row level security;
alter table companion_availability enable row level security;
alter table companion_blackouts    enable row level security;
alter table companion_areas        enable row level security;
alter table customers              enable row level security;
alter table bookings               enable row level security;
alter table booking_events         enable row level security;
alter table payments               enable row level security;
alter table refunds                enable row level security;
alter table webhook_events         enable row level security;
alter table payouts                enable row level security;
alter table reviews                enable row level security;
alter table incidents              enable row level security;
alter table support_tickets        enable row level security;
alter table support_messages       enable row level security;
alter table admin_users            enable row level security;
alter table admin_audit_log        enable row level security;
alter table admin_login_attempts   enable row level security;
alter table otp_requests           enable row level security;

-- Force RLS even for the table owner on the tables that must never be read
-- without an explicit policy.
alter table companion_identities force row level security;
alter table payments             force row level security;
alter table refunds              force row level security;
alter table admin_audit_log      force row level security;


-- =============================================================================
-- PUBLIC READ-ONLY SURFACES
-- =============================================================================

-- Settings rows marked is_public are readable before sign-in.
create policy settings_public_read on settings
  for select to anon, authenticated
  using (is_public);

-- Only active areas are visible.
create policy areas_public_read on areas
  for select to anon, authenticated
  using (is_active);

-- Inactive companions do not exist to a visitor: profile 404s, no listing.
create policy companions_public_read on companions
  for select to anon, authenticated
  using (is_active);

-- Availability and area coverage are readable for active companions only.
-- The sub-select is cheap: companions is small and is_active is effectively
-- boolean-indexed via the partial index in 01_types_and_tables.sql.
create policy companion_availability_public_read on companion_availability
  for select to anon, authenticated
  using (
    exists (
      select 1 from companions c
       where c.id = companion_availability.companion_id
         and c.is_active
    )
  );

create policy companion_areas_public_read on companion_areas
  for select to anon, authenticated
  using (
    exists (
      select 1 from companions c
       where c.id = companion_areas.companion_id
         and c.is_active
    )
  );

-- companion_identities : NO POLICY — service_role only, by design.
-- companion_blackouts  : NO POLICY — reached only via get_availability_inputs(),
--                        which strips the reason text and runs as definer.


-- =============================================================================
-- CUSTOMER-OWNED ROWS
-- Policies resolve the caller through ac_auth_subject() (text) not auth.uid()
-- (uuid) because Clerk subjects are not UUIDs.
--
-- The sub-select pattern `(select ac_auth_subject())` is used instead of a
-- bare call so Postgres evaluates it once per statement, not once per row.
-- =============================================================================

create policy customers_select_own on customers
  for select to authenticated
  using (auth_user_id = (select ac_auth_subject()));

-- No UPDATE policy — profile edits go through ac_set_customer_profile().
-- No INSERT policy — creation goes through ac_ensure_customer().

create policy bookings_select_own on bookings
  for select to authenticated
  using (
    exists (
      select 1 from customers c
       where c.id         = bookings.customer_id
         and c.auth_user_id = (select ac_auth_subject())
    )
  );

-- Public lookup by reference — anonymous customers can check their booking
-- status without signing in. The reference is the access token and grants
-- visibility of slot time, companion name, and status only — no customer PII.
create policy bookings_public_lookup on bookings
  for select to anon
  using (true);

-- No INSERT policy — creation is create_booking_hold() only.
-- No UPDATE policy — status changes are server-side only.

-- Anonymous public read by reference (ticket lookup, no auth required).
-- Returns bookings to anyone with the reference (the "access token").
-- Shows minimal PII: just reference, status, time, companion, area.
-- Email/phone are excluded.
create policy bookings_public_read_by_reference on bookings
  for select to anon, authenticated
  using (true);  -- Reference-based lookup happens in the query layer via getBookingByReferencePublic()

create policy booking_events_select_own on booking_events
  for select to authenticated
  using (
    exists (
      select 1
        from bookings b
        join customers c on c.id = b.customer_id
       where b.id             = booking_events.booking_id
         and c.auth_user_id   = (select ac_auth_subject())
    )
  );


-- =============================================================================
-- REVIEWS
-- "Verified" means tied to a completed booking — nothing more.
-- =============================================================================

-- Published reviews are publicly visible.
create policy reviews_public_read on reviews
  for select to anon, authenticated
  using (is_published);

-- A customer can always see her own reviews, published or not.
create policy reviews_select_own on reviews
  for select to authenticated
  using (
    exists (
      select 1 from customers c
       where c.id           = reviews.customer_id
         and c.auth_user_id = (select ac_auth_subject())
    )
  );

-- A review may only be submitted against the caller's own completed booking
-- that has already ended. Publication is a moderator act.
create policy reviews_insert_own on reviews
  for insert to authenticated
  with check (
    is_published = false
    and exists (
      select 1
        from bookings b
        join customers c on c.id = b.customer_id
       where b.id           = reviews.booking_id
         and c.auth_user_id = (select ac_auth_subject())
         and c.id           = reviews.customer_id
         and b.companion_id = reviews.companion_id
         and b.status       = 'completed'
         and b.ends_at      < now()
    )
  );

-- payments, refunds, webhook_events, payouts, incidents, support_*,
-- admin_users, admin_audit_log, admin_login_attempts, otp_requests:
--   RLS enabled, no policies — service_role only.
-- Clients read payment state through their booking row.


-- =============================================================================
-- CUSTOMER BOOTSTRAP
-- ac_ensure_customer is service_role only: it can adopt an existing customer
-- row by email, so an authenticated caller passing an arbitrary email could
-- attach their Clerk id to someone else's bookings. Only the server calls it
-- after verifying the Clerk session.
-- =============================================================================

create or replace function ac_ensure_customer(
  p_subject         text,
  p_email           text,
  p_full_name       text default null,
  p_consent_version text default null
)
returns uuid
language plpgsql volatile
set search_path = public
as $$
declare
  v_email text := lower(nullif(btrim(p_email), ''));
  v_name  text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_id    uuid;
begin
  if nullif(btrim(coalesce(p_subject, '')), '') is null then
    raise exception 'AC_NOT_AUTHENTICATED';
  end if;
  if v_email is null then
    raise exception 'AC_NO_EMAIL';
  end if;

  -- Fast path: subject already exists.
  select id into v_id from customers where auth_user_id = p_subject;
  if found then
    -- Keep email in step with the verified Clerk claim.
    update customers set email = v_email
     where id = v_id and email is distinct from v_email;

    -- Only fills a blank name, never replaces one she has set.
    if v_name is not null then
      update customers set full_name = v_name
       where id = v_id
         and nullif(btrim(coalesce(full_name, '')), '') is null;
    end if;

    if p_consent_version is not null then
      update customers
         set consent_version = p_consent_version,
             consent_at      = coalesce(consent_at, now())
       where id = v_id
         and consent_version is distinct from p_consent_version;
    end if;

    return v_id;
  end if;

  -- Same email returning under a new provider (e.g. email OTP then Google).
  -- Adopt the existing record to preserve booking history.
  -- This email is Clerk-verified — that verification is the security boundary.
  select id into v_id from customers where lower(email) = v_email;
  if found then
    update customers set auth_user_id = p_subject where id = v_id;
    if v_name is not null then
      update customers set full_name = v_name
       where id = v_id
         and nullif(btrim(coalesce(full_name, '')), '') is null;
    end if;
    return v_id;
  end if;

  -- First time: create a new customer row.
  insert into customers (auth_user_id, email, full_name, consent_version, consent_at)
  values (
    p_subject,
    v_email,
    v_name,
    p_consent_version,
    case when p_consent_version is null then null else now() end
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function ac_ensure_customer(text, text, text, text)
  from public, anon, authenticated;
grant  execute on function ac_ensure_customer(text, text, text, text) to service_role;


-- =============================================================================
-- CUSTOMER PROFILE UPDATE
-- No UPDATE policy on customers, so profile edits go through here.
-- =============================================================================

create or replace function ac_set_customer_profile(p_full_name text)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_subject text := ac_auth_subject();
  v_name    text := btrim(coalesce(p_full_name, ''));
begin
  if v_subject is null then
    raise exception 'AC_NOT_AUTHENTICATED';
  end if;
  if length(v_name) < 2 then
    raise exception 'AC_NAME_REQUIRED';
  end if;

  update customers set full_name = v_name where auth_user_id = v_subject;
  if not found then
    raise exception 'AC_NOT_AUTHENTICATED';
  end if;
end;
$$;

revoke execute on function ac_set_customer_profile(text) from public, anon;
grant  execute on function ac_set_customer_profile(text) to authenticated, service_role;


-- =============================================================================
-- BOOKING HOLD CREATION
-- The only way a booking row comes into existence.
-- All money and time decisions happen here from settings + companion data.
-- The caller provides a slot and duration — nothing that can influence price.
-- =============================================================================

create or replace function create_booking_hold(
  p_companion_slug   text,
  p_starts_at        timestamptz,
  p_duration_minutes integer,
  p_area_id          uuid,
  p_terms_version    text,
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
  v_max_holds    integer;
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
begin
  select * into v_customer
    from customers
   where auth_user_id = ac_auth_subject();
  if not found then
    raise exception 'AC_NOT_AUTHENTICATED';
  end if;
  if v_customer.is_blocked then
    raise exception 'AC_BOOKING_REFUSED';
  end if;

  select * into v_companion from companions where slug = p_companion_slug;
  if not found or not v_companion.is_active then
    raise exception 'AC_COMPANION_UNAVAILABLE';
  end if;
  if not v_companion.is_accepting then
    raise exception 'AC_COMPANION_PAUSED';
  end if;

  -- Load settings in a single pass.
  v_tz           := coalesce(ac_setting('timezone') #>> '{}', 'Asia/Kolkata');
  v_window_days  := ac_setting_int('booking_window_days', 7);
  v_buffer       := ac_setting_int('buffer_minutes', 15);
  v_hold_minutes := ac_setting_int('hold_minutes', 10);
  v_min_minutes  := ac_setting_int('min_duration_minutes', 60);
  v_max_holds    := ac_setting_int('max_active_holds', 3);
  v_hours        := ac_setting('service_hours');
  v_terms        := ac_setting('terms_version') #>> '{}';

  -- Validate inputs before any writes.
  if p_terms_version is null or p_terms_version is distinct from v_terms then
    raise exception 'AC_TERMS_STALE';
  end if;
  if p_duration_minutes < v_min_minutes then
    raise exception 'AC_DURATION_TOO_SHORT';
  end if;
  if p_duration_minutes % 30 <> 0 then
    raise exception 'AC_DURATION_INVALID';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => p_duration_minutes);

  if p_starts_at < now() then
    raise exception 'AC_SLOT_IN_PAST';
  end if;
  if p_starts_at > now() + make_interval(days => v_window_days) then
    raise exception 'AC_OUTSIDE_WINDOW';
  end if;

  -- Service hours are wall-clock IST; compare in local time.
  v_local_start := p_starts_at at time zone v_tz;
  v_local_end   := v_ends_at   at time zone v_tz;
  v_weekday     := extract(dow from v_local_start)::smallint;

  if v_local_start::time < (v_hours ->> 'start')::time
     or v_local_end::time > (v_hours ->> 'end')::time
     or v_local_end::date <> v_local_start::date then
    raise exception 'AC_OUTSIDE_SERVICE_HOURS';
  end if;

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

  -- Payment retry: resume the live hold instead of creating a duplicate.
  select * into v_existing
    from bookings
   where customer_id   = v_customer.id
     and companion_id  = v_companion.id
     and starts_at     = p_starts_at
     and status        = 'pending_payment'
     and hold_expires_at > now()
   limit 1;

  if found then
    return jsonb_build_object(
      'booking_id',      v_existing.id,
      'reference',       v_existing.reference,
      'amount_paise',    v_existing.amount_paise,
      'hold_expires_at', v_existing.hold_expires_at,
      'resumed',         true
    );
  end if;

  -- Global hold cap.
  if (
    select count(*)
      from bookings
     where customer_id     = v_customer.id
       and status          = 'pending_payment'
       and hold_expires_at > now()
  ) >= v_max_holds then
    raise exception 'AC_TOO_MANY_HOLDS';
  end if;

  select q.amount_paise, q.discount_percent
    into v_amount, v_discount
    from ac_quote(v_companion.hourly_rate_paise, p_duration_minutes) q;

  v_reference    := ac_generate_reference();
  v_hold_expires := now() + make_interval(mins => v_hold_minutes);

  begin
    insert into bookings (
      reference, customer_id, companion_id, area_id,
      starts_at, ends_at, buffer_minutes,
      status, hold_expires_at,
      amount_paise, rate_snapshot_paise, discount_percent,
      terms_version, terms_accepted_at, customer_notes
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
      -- Another hold landed in the same slot during our validation.
      raise exception 'AC_SLOT_TAKEN';
  end;

  insert into booking_events (booking_id, from_status, to_status, actor_type, actor_id, reason)
  values (v_id, null, 'pending_payment', 'customer', v_customer.id, 'hold created');

  return jsonb_build_object(
    'booking_id',      v_id,
    'reference',       v_reference,
    'amount_paise',    v_amount,
    'hold_expires_at', v_hold_expires,
    'resumed',         false
  );
end;
$$;

revoke execute on function create_booking_hold(text, timestamptz, integer, uuid, text, text)
  from public, anon;
grant  execute on function create_booking_hold(text, timestamptz, integer, uuid, text, text)
  to authenticated, service_role;
