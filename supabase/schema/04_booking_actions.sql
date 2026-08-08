-- =============================================================================
-- AlongCo — 04_booking_actions.sql
--
-- Customer-facing booking mutations and admin cancellation/refund logic.
-- All functions use security definer + explicit search_path.
-- =============================================================================


-- =============================================================================
-- BOOKING DETAILS (customer fills name, phone, area after creating the hold)
-- =============================================================================

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

  -- Normalise to E.164 without the '+': strip non-digits, prepend country code.
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
    -- customers.phone is unique; another account holds this number.
    raise exception 'AC_PHONE_IN_USE';
end;
$$;

revoke execute on function ac_set_booking_details(uuid, text, text, uuid, text) from public, anon;
grant  execute on function ac_set_booking_details(uuid, text, text, uuid, text)
  to authenticated, service_role;


-- =============================================================================
-- CUSTOMER CANCELLATION
-- Moves status, records cancellation metadata, and returns the refund quote
-- so the UI can state what will be returned before the customer confirms.
-- The refund itself is issued against the gateway by the admin/refund worker.
-- =============================================================================

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


-- =============================================================================
-- CANCELLATION PREVIEW
-- Returns what a cancellation would refund without committing anything.
-- Needed because ac_refund_quote is service_role-only.
-- =============================================================================

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


-- =============================================================================
-- ADMIN CANCELLATION
-- Handles every cancellation trigger: admin, companion cancel/no-show,
-- customer no-show, and conduct breach. Each trigger implies a specific
-- terminal status and refund tier — they cannot be paired wrongly by a caller.
--
-- What this function owns: money arithmetic, status transition, refund row.
-- What the server action owns: the gateway network call, then writing back the
-- provider's refund id and final status onto the row.
--
-- Recording the refund row before the network call is deliberate: if the
-- process dies between the two, the refund row exists and can be reconciled.
-- Doing it the other way round loses the refund entirely.
-- =============================================================================

create or replace function ac_refund_reference(p_booking_reference text)
returns text
language plpgsql volatile
set search_path = public
as $$
declare
  v_n integer;
begin
  -- Sequence number within this booking's refunds, starting at 1.
  select count(*) + 1 into v_n
    from refunds r
    join bookings b on b.id = r.booking_id
   where b.reference = p_booking_reference;

  return 'R' || p_booking_reference || '-' || v_n::text;
end;
$$;

revoke execute on function ac_refund_reference(text) from public, anon, authenticated;
grant  execute on function ac_refund_reference(text) to service_role;


create or replace function ac_admin_cancel_booking(
  p_booking_id           uuid,
  p_admin_id             uuid,
  p_trigger              text,
  p_reason               text          default null,
  p_incident_type        incident_type default null,
  p_incident_description text          default null
)
returns jsonb
language plpgsql volatile
set search_path = public
as $$
declare
  v_booking      bookings%rowtype;
  v_quote        record;
  v_payment      payments%rowtype;
  v_status       booking_status;
  v_cancelled_by text;
  v_refund_id    uuid;
  v_reference    text;
  v_incident     uuid;
begin
  if p_trigger not in (
    'admin_cancel', 'companion_cancel', 'companion_no_show',
    'customer_no_show', 'conduct_breach'
  ) then
    raise exception 'AC_UNKNOWN_TRIGGER';
  end if;

  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then
    raise exception 'AC_BOOKING_NOT_FOUND';
  end if;

  if v_booking.status not in ('pending_payment', 'confirmed', 'completed') then
    raise exception 'AC_NOT_CANCELLABLE';
  end if;

  -- Ending a session early always requires an incident description.
  if p_trigger = 'conduct_breach'
     and coalesce(btrim(p_incident_description), '') = '' then
    raise exception 'AC_INCIDENT_REQUIRED';
  end if;

  -- Map trigger → terminal status.
  v_status := case p_trigger
    when 'companion_no_show' then 'no_show_companion'::booking_status
    when 'customer_no_show'  then 'no_show_customer'::booking_status
    when 'conduct_breach'    then 'ended_early'::booking_status
    else                          'cancelled_by_admin'::booking_status
  end;

  v_cancelled_by := case
    when p_trigger in ('companion_cancel', 'companion_no_show', 'conduct_breach')
    then 'companion'
    else 'admin'
  end;

  select * into v_quote
    from ac_refund_quote(
      p_booking_id,
      case when p_trigger = 'admin_cancel' then 'customer_cancel' else p_trigger end,
      now()
    );

  -- Find the most recent captured payment — that is what the refund goes back to.
  select * into v_payment
    from payments
   where booking_id = p_booking_id
     and status in ('captured', 'partially_refunded')
   order by captured_at desc nulls last
   limit 1;

  update bookings
     set cancelled_at        = now(),
         cancelled_by        = v_cancelled_by,
         cancellation_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         refund_tier_applied = v_quote.tier_code
   where id = p_booking_id;

  perform ac_set_booking_status(
    p_booking_id, v_status, 'admin', p_admin_id,
    coalesce(nullif(btrim(coalesce(p_reason, '')), ''), p_trigger)
  );

  -- Incident record (required for conduct_breach, optional for others).
  if coalesce(btrim(p_incident_description), '') <> '' then
    insert into incidents (
      booking_id, companion_id, customer_id,
      type, status, reported_by, description,
      ended_booking, refund_issued, created_by
    )
    values (
      p_booking_id, v_booking.companion_id, v_booking.customer_id,
      coalesce(p_incident_type, 'other'), 'open', 'admin',
      btrim(p_incident_description),
      p_trigger = 'conduct_breach',
      v_quote.amount_paise > 0 and v_payment.id is not null,
      p_admin_id
    )
    returning id into v_incident;
  end if;

  -- Refund row (created before the gateway call — see header comment).
  if v_quote.amount_paise > 0 and v_payment.id is not null then
    v_reference := ac_refund_reference(v_booking.reference);

    insert into refunds (
      payment_id, booking_id, refund_reference, amount_paise,
      status, tier_applied, initiated_by, notes
    )
    values (
      v_payment.id, p_booking_id, v_reference, v_quote.amount_paise,
      'created', v_quote.tier_code, p_admin_id, p_trigger
    )
    returning id into v_refund_id;
  end if;

  return jsonb_build_object(
    'to_status',           v_status,
    'tier_code',           v_quote.tier_code,
    'percent',             v_quote.percent,
    'refund_amount_paise', coalesce(case when v_refund_id is not null then v_quote.amount_paise end, 0),
    'refund_id',           v_refund_id,
    'refund_reference',    v_reference,
    'incident_id',         v_incident,
    'payment_provider',    v_payment.payment_provider,
    'provider_order_id',   v_payment.provider_order_id,
    -- Razorpay refunds are against the payment id, not the order.
    'provider_payment_id', v_payment.provider_payment_id
  );
end;
$$;

revoke execute on function ac_admin_cancel_booking(uuid, uuid, text, text, incident_type, text)
  from public, anon, authenticated;
grant  execute on function ac_admin_cancel_booking(uuid, uuid, text, text, incident_type, text)
  to service_role;


-- =============================================================================
-- REVIEW PUBLISHABILITY CHECK
-- A review tied to an open incident must not be published automatically.
-- Admin canvas calls this before the publish button is enabled.
-- =============================================================================

create or replace function ac_review_publishable(p_review_id uuid)
returns boolean
language sql stable
set search_path = public
as $$
  select not exists (
    select 1
      from reviews rv
      join incidents i on i.booking_id = rv.booking_id
     where rv.id = p_review_id
       and i.status in ('open', 'investigating')
  );
$$;

revoke execute on function ac_review_publishable(uuid) from public, anon;
grant  execute on function ac_review_publishable(uuid) to authenticated, service_role;


-- =============================================================================
-- ACTION RATE LIMITER (post-authentication)
-- Keyed on the customer id — simpler and harder to evade than IP.
-- Uses advisory locks to prevent two concurrent requests from both reading
-- the same count and slipping through.
-- =============================================================================

create or replace function ac_check_action_rate_limit(
  p_action      text,
  p_customer_id uuid
)
returns table (allowed boolean, retry_after_seconds integer, reason text)
language plpgsql volatile
set search_path = public
as $$
declare
  v_recent integer;
  v_lock   text := 'ac-action:' || p_action || ':' || p_customer_id::text;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_lock, 0));

  if p_action = 'booking_hold' then
    -- Limit unpaid / expired holds to prevent slot-squatting.
    select count(*) into v_recent
      from bookings
     where customer_id = p_customer_id
       and status in ('pending_payment', 'expired')
       and created_at >= now() - interval '1 hour';

    if v_recent >= 8 then
      return query select false, 3600,
        'Too many holds without payment. Try again in an hour, or call us.'::text;
      return;
    end if;

    select count(*) into v_recent
      from bookings
     where customer_id = p_customer_id
       and created_at >= now() - interval '1 minute';

    if v_recent >= 3 then
      return query select false, 60,
        'That was very quick. Wait a moment and try again.'::text;
      return;
    end if;

  elsif p_action = 'review' then
    select count(*) into v_recent
      from reviews
     where customer_id = p_customer_id
       and created_at >= now() - interval '1 hour';

    if v_recent >= 5 then
      return query select false, 3600,
        'You have left several reviews just now. Try again in an hour.'::text;
      return;
    end if;

  else
    raise exception 'AC_UNKNOWN_RATE_LIMIT_ACTION';
  end if;

  return query select true, 0, null::text;
end;
$$;

revoke all on function ac_check_action_rate_limit(text, uuid) from public, anon;
grant  execute on function ac_check_action_rate_limit(text, uuid) to authenticated, service_role;
