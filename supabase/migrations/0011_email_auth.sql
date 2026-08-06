-- AlongCo — 0011_email_auth.sql
--
-- Customer sign-in moves from phone OTP to email OTP.
--
-- SMS in India needs DLT registration and costs money per message; email OTP
-- needs neither. The consequence, and it is a real one: the phone number is no
-- longer verified by the act of signing in. It becomes a self-declared field on
-- the booking details form.
--
-- That matters because the entire coordination model is a WhatsApp message to
-- that number (PRD §6.8). A mistyped digit now means she pays and hears
-- nothing. Two things already in place absorb it: the on-site ticket is the
-- real confirmation (PRD §12 says so explicitly), and the admin confirmation
-- queue flags anything unsent past the SLA. Nothing here weakens either.

-- ---------------------------------------------------------------------------
-- customers: email becomes the identity, phone becomes contact detail
-- ---------------------------------------------------------------------------

alter table customers add column if not exists email text;

-- Phone is now collected at checkout rather than proven at sign-in, so it can
-- legitimately be absent between first sign-in and first booking.
alter table customers alter column phone drop not null;

-- Still unique where present. Postgres allows many NULLs under a unique
-- constraint, which is exactly the behaviour wanted: one account per real
-- number, any number of accounts that have not given one yet.
create unique index if not exists customers_email_key on customers (lower(email));

-- ---------------------------------------------------------------------------
-- ac_ensure_customer, on the email claim
-- ---------------------------------------------------------------------------

create or replace function ac_ensure_customer(p_consent_version text default null)
returns uuid
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'AC_NOT_AUTHENTICATED';
  end if;
  if v_email is null then
    raise exception 'AC_NO_EMAIL_CLAIM';
  end if;

  select id into v_id from customers where auth_user_id = v_uid;
  if found then
    -- Keep the stored address in step with the verified claim.
    update customers set email = v_email where id = v_id and email is distinct from v_email;

    if p_consent_version is not null then
      update customers
         set consent_version = p_consent_version,
             consent_at      = coalesce(consent_at, now())
       where id = v_id and consent_version is distinct from p_consent_version;
    end if;
    return v_id;
  end if;

  -- Same address returning on a new auth user: adopt the existing record rather
  -- than orphaning her booking history.
  select id into v_id from customers where lower(email) = v_email;
  if found then
    update customers set auth_user_id = v_uid where id = v_id;
    return v_id;
  end if;

  insert into customers (auth_user_id, email, consent_version, consent_at)
  values (v_uid, v_email, p_consent_version,
          case when p_consent_version is null then null else now() end)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function ac_ensure_customer(text) from public, anon;
grant  execute on function ac_ensure_customer(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ac_set_booking_details now also captures the WhatsApp number
--
-- The old four-argument signature is dropped rather than left in place: it
-- would silently write a booking with no reachable number, which is the one
-- failure this whole flow exists to prevent.
-- ---------------------------------------------------------------------------

drop function if exists ac_set_booking_details(uuid, text, uuid, text);

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
  select * into v_customer from customers where auth_user_id = auth.uid();
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

  update customers
     set full_name = v_name,
         phone     = v_phone
   where id = v_customer.id;

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
    -- customers.phone is unique. Another account already proved this number.
    raise exception 'AC_PHONE_IN_USE';
end;
$$;

revoke execute on function ac_set_booking_details(uuid, text, text, uuid, text) from public, anon;
grant  execute on function ac_set_booking_details(uuid, text, text, uuid, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The abuse counter is keyed on a hashed identifier, not on a phone
-- specifically. Only the column name carried the assumption.
-- ---------------------------------------------------------------------------

-- Conditional: the hosted project was found already carrying the renamed
-- column, so a bare RENAME aborts there and takes the rest of the file with it.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'otp_requests'
       and column_name  = 'phone_hash'
  ) then
    alter table otp_requests rename column phone_hash to identifier_hash;
  end if;
end
$$;

drop function if exists ac_consume_otp_rate_limit(text, text);

create or replace function ac_consume_otp_rate_limit(
  p_identifier_hash text,
  p_ip_hash         text
)
returns table (allowed boolean, retry_after_seconds integer, scope text)
-- security definer, as in 0006: this runs for `anon` before there is any
-- session, and otp_requests has RLS on with no policy. Without it the limiter
-- cannot record the attempt and every sign-in fails.
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_id_count integer;
  v_ip_count integer;
  v_id_lock  text := 'otp-id:' || p_identifier_hash;
  v_ip_lock  text := 'otp-ip:' || p_ip_hash;
begin
  if p_identifier_hash !~ '^[a-f0-9]{64}$' or p_ip_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'AC_INVALID_RATE_LIMIT_KEY';
  end if;

  if v_id_lock < v_ip_lock then
    perform pg_advisory_xact_lock(hashtextextended(v_id_lock, 0));
    perform pg_advisory_xact_lock(hashtextextended(v_ip_lock, 0));
  else
    perform pg_advisory_xact_lock(hashtextextended(v_ip_lock, 0));
    perform pg_advisory_xact_lock(hashtextextended(v_id_lock, 0));
  end if;

  select count(*) into v_id_count
    from otp_requests
   where identifier_hash = p_identifier_hash
     and requested_at >= now() - interval '1 minute';
  if v_id_count >= 5 then
    return query select false, 60, 'identifier'::text;
    return;
  end if;

  select count(*) into v_id_count
    from otp_requests
   where identifier_hash = p_identifier_hash
     and requested_at >= now() - interval '1 hour';
  if v_id_count >= 15 then
    return query select false, 3600, 'identifier'::text;
    return;
  end if;

  select count(*) into v_ip_count
    from otp_requests
   where ip_hash = p_ip_hash
     and requested_at >= now() - interval '1 hour';
  if v_ip_count >= 40 then
    return query select false, 3600, 'ip'::text;
    return;
  end if;

  insert into otp_requests (identifier_hash, ip_hash) values (p_identifier_hash, p_ip_hash);
  delete from otp_requests where requested_at < now() - interval '7 days';

  return query select true, 0, null::text;
end;
$$;

revoke execute on function ac_consume_otp_rate_limit(text, text) from public;
grant  execute on function ac_consume_otp_rate_limit(text, text)
  to anon, authenticated, service_role;
