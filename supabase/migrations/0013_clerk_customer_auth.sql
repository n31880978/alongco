-- AlongCo — 0013_clerk_customer_auth.sql
--
-- Customer identity moves from Supabase Auth to Clerk. Admin sign-in does not:
-- it stays on Supabase email + password, which is what keeps CLAUDE.md §9's
-- "different credential class" defence real — a customer holding a Clerk
-- session carries a credential the admin surface does not accept at all.
--
-- The reason this is a schema change and not just an app change:
--
--   auth.uid() is `(current_setting('request.jwt.claims')::json ->> 'sub')::uuid`
--
-- It CASTS the subject claim to uuid. Supabase issues uuid subjects, so that
-- worked. Clerk issues `user_2abc123…`, which is not a uuid, so every policy
-- calling auth.uid() would raise `invalid input syntax for type uuid` on a
-- Clerk token — a hard error on every customer read, not a quiet denial.
--
-- So the subject is read as text throughout, and customers.auth_user_id
-- becomes text to hold it. Safe to do as a plain type change here because the
-- table has no rows yet; with live customers this would need a backfill from
-- Clerk before the constraint could be trusted.
--
-- Everything admin-facing is untouched: admin_users.id stays uuid, and the
-- admin tables are service_role-only with no policies, so they never consult
-- auth.uid() at all.

-- ---------------------------------------------------------------------------
-- The subject claim, read once and safely.
--
-- Returns null rather than raising when there is no session, so a policy on an
-- anonymous request simply matches nothing.
-- ---------------------------------------------------------------------------

create or replace function ac_auth_subject()
returns text
language sql stable
set search_path = public
as $$
  select nullif(auth.jwt() ->> 'sub', '');
$$;

comment on function ac_auth_subject() is
  'The verified JWT subject as text. Clerk user ids are not uuids, so auth.uid() cannot be used for customer identity.';

grant execute on function ac_auth_subject() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- customers.auth_user_id: uuid -> text
--
-- Postgres refuses to alter the type of a column any policy references, so
-- every dependent policy comes down first and goes back up afterwards. They
-- are recreated immediately below — there is no window where the table is
-- readable without them, because this file runs in one transaction.
-- ---------------------------------------------------------------------------

drop policy if exists customers_select_own      on customers;
drop policy if exists bookings_select_own       on bookings;
drop policy if exists booking_events_select_own on booking_events;
drop policy if exists reviews_select_own        on reviews;
drop policy if exists reviews_insert_own        on reviews;

alter table customers
  alter column auth_user_id type text using auth_user_id::text;

-- ---------------------------------------------------------------------------
-- Policies, recreated against the text subject.
-- ---------------------------------------------------------------------------

create policy customers_select_own on customers
  for select to authenticated
  using (auth_user_id = (select ac_auth_subject()));

create policy bookings_select_own on bookings
  for select to authenticated
  using (
    exists (
      select 1 from customers c
       where c.id = bookings.customer_id
         and c.auth_user_id = (select ac_auth_subject())
    )
  );

create policy booking_events_select_own on booking_events
  for select to authenticated
  using (
    exists (
      select 1
        from bookings b
        join customers c on c.id = b.customer_id
       where b.id = booking_events.booking_id
         and c.auth_user_id = (select ac_auth_subject())
    )
  );

create policy reviews_select_own on reviews
  for select to authenticated
  using (
    exists (
      select 1 from customers c
       where c.id = reviews.customer_id
         and c.auth_user_id = (select ac_auth_subject())
    )
  );

-- Unchanged in substance: a review may only be written against the caller's own
-- completed booking that has already ended (PRD §6.10).
create policy reviews_insert_own on reviews
  for insert to authenticated
  with check (
    is_published = false
    and exists (
      select 1
        from bookings b
        join customers c on c.id = b.customer_id
       where b.id = reviews.booking_id
         and c.auth_user_id = (select ac_auth_subject())
         and c.id = reviews.customer_id
         and b.companion_id = reviews.companion_id
         and b.status = 'completed'
         and b.ends_at < now()
    )
  );

-- ---------------------------------------------------------------------------
-- Functions that resolved the caller through auth.uid().
--
-- Each keeps its behaviour exactly; only the lookup changes.
-- ---------------------------------------------------------------------------

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

/**
 * ac_ensure_customer is now service_role only.
 *
 * It takes the subject and email as arguments rather than reading them from the
 * JWT, because Clerk's session token does not carry an email claim by default.
 * That makes the grant the security boundary: the function adopts an existing
 * customer row by email, so an `authenticated` caller able to pass an arbitrary
 * email could attach their Clerk id to somebody else's bookings. Only the
 * server may call it, after verifying the Clerk session itself.
 */
drop function if exists ac_ensure_customer(text);

create or replace function ac_ensure_customer(
  p_subject         text,
  p_email           text,
  p_full_name       text    default null,
  p_consent_version text    default null
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

  select id into v_id from customers where auth_user_id = p_subject;
  if found then
    update customers set email = v_email
     where id = v_id and email is distinct from v_email;

    -- Only ever fills a blank. Never replaces a name she has given.
    if v_name is not null then
      update customers set full_name = v_name
       where id = v_id and nullif(btrim(coalesce(full_name, '')), '') is null;
    end if;

    if p_consent_version is not null then
      update customers
         set consent_version = p_consent_version,
             consent_at      = coalesce(consent_at, now())
       where id = v_id and consent_version is distinct from p_consent_version;
    end if;
    return v_id;
  end if;

  -- Same address returning under a new identity provider — she signed up with
  -- an emailed code and comes back through Google, or the reverse. Adopt the
  -- existing record rather than orphaning her booking history.
  --
  -- This is the line that makes the verified-email check in the application a
  -- security boundary rather than a nicety.
  select id into v_id from customers where lower(email) = v_email;
  if found then
    update customers set auth_user_id = p_subject where id = v_id;
    if v_name is not null then
      update customers set full_name = v_name
       where id = v_id and nullif(btrim(coalesce(full_name, '')), '') is null;
    end if;
    return v_id;
  end if;

  insert into customers (auth_user_id, email, full_name, consent_version, consent_at)
  values (p_subject, v_email, v_name, p_consent_version,
          case when p_consent_version is null then null else now() end)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function ac_ensure_customer(text, text, text, text)
  from public, anon, authenticated;
grant  execute on function ac_ensure_customer(text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- The three booking functions. Same logic, text subject.
-- ---------------------------------------------------------------------------

create or replace function ac_set_booking_details(
  p_booking_id uuid,
  p_full_name  text,
  p_phone      text,
  p_area_id    uuid,
  p_notes      text default null
)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_customer customers%rowtype;
  v_booking  bookings%rowtype;
  v_phone    text;
  v_name     text := btrim(coalesce(p_full_name, ''));
begin
  select * into v_customer from customers where auth_user_id = ac_auth_subject();
  if not found then
    raise exception 'AC_NOT_AUTHENTICATED';
  end if;

  if length(v_name) < 2 then
    raise exception 'AC_NAME_REQUIRED';
  end if;

  v_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if length(v_phone) = 10 then
    v_phone := '91' || v_phone;
  end if;
  if v_phone !~ '^91[6-9][0-9]{9}$' then
    raise exception 'AC_PHONE_INVALID';
  end if;

  select * into v_booking
    from bookings
   where id = p_booking_id and customer_id = v_customer.id
   for update;
  if not found then
    raise exception 'AC_BOOKING_NOT_FOUND';
  end if;

  if v_booking.status <> 'pending_payment' then
    raise exception 'AC_NOT_EDITABLE';
  end if;

  if v_booking.hold_expires_at is not null and v_booking.hold_expires_at < now() then
    raise exception 'AC_HOLD_EXPIRED';
  end if;

  if not exists (select 1 from areas where id = p_area_id and is_active) then
    raise exception 'AC_AREA_INVALID';
  end if;

  update customers set full_name = v_name, phone = v_phone where id = v_customer.id;

  update bookings
     set area_id        = p_area_id,
         customer_notes = nullif(btrim(coalesce(p_notes, '')), '')
   where id = p_booking_id;

  return jsonb_build_object(
    'booking_id',      p_booking_id,
    'hold_expires_at', v_booking.hold_expires_at
  );
exception
  when unique_violation then
    raise exception 'AC_PHONE_IN_USE';
end;
$$;

revoke execute on function ac_set_booking_details(uuid, text, text, uuid, text)
  from public, anon;
grant  execute on function ac_set_booking_details(uuid, text, text, uuid, text)
  to authenticated, service_role;

create or replace function ac_cancel_own_booking(
  p_booking_id uuid,
  p_reason     text default null
)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_customer customers%rowtype;
  v_booking  bookings%rowtype;
  v_quote    record;
begin
  select * into v_customer from customers where auth_user_id = ac_auth_subject();
  if not found then
    raise exception 'AC_NOT_AUTHENTICATED';
  end if;

  select * into v_booking
    from bookings
   where id = p_booking_id and customer_id = v_customer.id
   for update;
  if not found then
    raise exception 'AC_BOOKING_NOT_FOUND';
  end if;

  if v_booking.status not in ('pending_payment', 'confirmed') then
    raise exception 'AC_NOT_CANCELLABLE';
  end if;

  select * into v_quote from ac_refund_quote(p_booking_id, 'customer_cancel', now());

  update bookings
     set cancelled_at        = now(),
         cancelled_by        = 'customer',
         cancellation_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         refund_tier_applied = case when v_booking.status = 'confirmed'
                                    then v_quote.tier_code else null end
   where id = p_booking_id;

  perform ac_set_booking_status(
    p_booking_id, 'cancelled_by_customer', 'customer', v_customer.id, p_reason
  );

  return jsonb_build_object(
    'refund_amount_paise', case when v_booking.status = 'confirmed'
                                then v_quote.amount_paise else 0 end,
    'refund_percent',      v_quote.percent,
    'tier_code',           v_quote.tier_code,
    'was_paid',            v_booking.status = 'confirmed'
  );
end;
$$;

revoke execute on function ac_cancel_own_booking(uuid, text) from public, anon;
grant  execute on function ac_cancel_own_booking(uuid, text) to authenticated, service_role;

create or replace function ac_quote_own_cancellation(p_booking_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_customer customers%rowtype;
  v_booking  bookings%rowtype;
  v_quote    record;
begin
  select * into v_customer from customers where auth_user_id = ac_auth_subject();
  if not found then
    raise exception 'AC_NOT_AUTHENTICATED';
  end if;

  select * into v_booking from bookings
   where id = p_booking_id and customer_id = v_customer.id;
  if not found then
    raise exception 'AC_BOOKING_NOT_FOUND';
  end if;

  select * into v_quote from ac_refund_quote(p_booking_id, 'customer_cancel', now());

  return jsonb_build_object(
    'refund_amount_paise', case when v_booking.status = 'confirmed'
                                then v_quote.amount_paise else 0 end,
    'refund_percent',      v_quote.percent,
    'tier_code',           v_quote.tier_code,
    'amount_paid_paise',   case when v_booking.status = 'confirmed'
                                then v_booking.amount_paise else 0 end
  );
end;
$$;

revoke execute on function ac_quote_own_cancellation(uuid) from public, anon;
grant  execute on function ac_quote_own_cancellation(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_booking_hold — the only way a booking row comes into existence.
--
-- Reproduced verbatim from 0003_rls.sql with exactly one line changed: the
-- customer lookup now resolves through ac_auth_subject() instead of auth.uid().
-- Everything that decides money or time is untouched — the amount still comes
-- from the companion's current rate, the TTL and buffer still come from
-- settings, and the exclusion_violation handler is still what turns a lost race
-- into AC_SLOT_TAKEN rather than a double booking (CLAUDE.md §3.1, §3.5).
-- ---------------------------------------------------------------------------

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
  select * into v_customer from customers where auth_user_id = ac_auth_subject();
  if not found then
    raise exception 'AC_NOT_AUTHENTICATED';
  end if;
  -- Neutral refusal, no slot held (PRD §6.3).
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

  v_tz           := coalesce(ac_setting('timezone') #>> '{}', 'Asia/Kolkata');
  v_window_days  := ac_setting_int('booking_window_days', 7);
  v_buffer       := ac_setting_int('buffer_minutes', 15);
  v_hold_minutes := ac_setting_int('hold_minutes', 10);
  v_min_minutes  := ac_setting_int('min_duration_minutes', 60);
  v_max_holds    := ac_setting_int('max_active_holds', 3);
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
       and av.weekday = v_weekday
       and av.start_time <= v_local_start::time
       and av.end_time   >= v_local_end::time
  ) then
    raise exception 'AC_NOT_WORKING';
  end if;

  if exists (
    select 1 from companion_blackouts b
     where b.companion_id = v_companion.id
       and b.starts_at < v_ends_at
       and b.ends_at   > p_starts_at
  ) then
    raise exception 'AC_SLOT_TAKEN';
  end if;

  -- Retrying a failed payment must resume the same booking, not create a
  -- second one (PRD §6.6).
  select * into v_existing
    from bookings
   where customer_id = v_customer.id
     and companion_id = v_companion.id
     and starts_at = p_starts_at
     and status = 'pending_payment'
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

  if (select count(*) from bookings
       where customer_id = v_customer.id
         and status = 'pending_payment'
         and hold_expires_at > now()) >= v_max_holds then
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
      p_terms_version, now(), nullif(btrim(coalesce(p_customer_notes, '')), '')
    )
    returning id into v_id;
  exception
    when exclusion_violation then
      -- Someone else's hold landed first. §3.5 — this is the database saying no,
      -- not the UI guessing.
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
