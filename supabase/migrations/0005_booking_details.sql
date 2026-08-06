-- AlongCo — 0005_booking_details.sql
--
-- The design canvas collects the meeting area on the details screen, after the
-- hold exists. bookings has no UPDATE policy and never will, so the edit goes
-- through this definer RPC, which re-validates the area against the companion's
-- own areas rather than trusting the form.

create or replace function ac_set_booking_details(
  p_booking_id uuid,
  p_full_name  text,
  p_area_id    uuid,
  p_notes      text default null
)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_customer  customers%rowtype;
  v_booking   bookings%rowtype;
begin
  select * into v_customer from customers where auth_user_id = auth.uid();
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

  if v_booking.status <> 'pending_payment' then
    raise exception 'AC_BOOKING_NOT_EDITABLE';
  end if;
  if v_booking.hold_expires_at is null or v_booking.hold_expires_at <= now() then
    raise exception 'AC_HOLD_EXPIRED';
  end if;

  if p_full_name is null or length(btrim(p_full_name)) < 2 then
    raise exception 'AC_INVALID_NAME';
  end if;

  if not exists (
    select 1 from companion_areas ca
      join areas a on a.id = ca.area_id
     where ca.companion_id = v_booking.companion_id
       and ca.area_id = p_area_id
       and a.is_active
  ) then
    raise exception 'AC_AREA_UNAVAILABLE';
  end if;

  update customers set full_name = btrim(p_full_name) where id = v_customer.id;

  update bookings
     set area_id        = p_area_id,
         customer_notes = nullif(btrim(coalesce(p_notes, '')), '')
   where id = p_booking_id;

  return jsonb_build_object(
    'booking_id',      v_booking.id,
    'hold_expires_at', v_booking.hold_expires_at
  );
end;
$$;

revoke execute on function ac_set_booking_details(uuid, text, uuid, text) from public;
grant  execute on function ac_set_booking_details(uuid, text, uuid, text)
  to authenticated, service_role;

-- Cancellation by the customer. Refund is quoted and issued server-side by the
-- admin/Cashfree path; this only moves the booking and frees the slot.
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
  select * into v_customer from customers where auth_user_id = auth.uid();
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

  -- The refund itself is issued against Cashfree by the admin/refund worker;
  -- this reports what is owed so the UI can state it before she confirms.
  return jsonb_build_object(
    'refund_amount_paise', case when v_booking.status = 'confirmed'
                                then v_quote.amount_paise else 0 end,
    'refund_percent',      v_quote.percent,
    'tier_code',           v_quote.tier_code,
    'was_paid',            v_booking.status = 'confirmed'
  );
end;
$$;

revoke execute on function ac_cancel_own_booking(uuid, text) from public;
grant  execute on function ac_cancel_own_booking(uuid, text) to authenticated, service_role;

-- Customers need to see what a cancellation would return *before* confirming
-- it (PRD §6.9), and ac_refund_quote itself is service_role only.
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
  select * into v_customer from customers where auth_user_id = auth.uid();
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

revoke execute on function ac_quote_own_cancellation(uuid) from public;
grant  execute on function ac_quote_own_cancellation(uuid) to authenticated, service_role;
