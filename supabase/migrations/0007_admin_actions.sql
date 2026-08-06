-- AlongCo — admin cancellation, refunds and incidents. PRD §6.9, §6.11.
--
-- The split of responsibility here is deliberate:
--   this function      owns the money arithmetic, the status transition and the
--                      refund row, all inside one transaction;
--   the server action  owns the Cashfree network call and writes the provider's
--                      id and status back onto the row it was handed.
--
-- Doing it the other way round — calling Cashfree first, then recording it —
-- loses the refund if the process dies between the two, and there is then no
-- record that money left the account.

-- ---------------------------------------------------------------------------
-- Refund references. Ours, not Cashfree's, and idempotent: sending the same
-- refund_id twice makes Cashfree return the first refund rather than issue a
-- second one (lib/cashfree/refunds.ts).
-- ---------------------------------------------------------------------------

create or replace function ac_refund_reference(p_booking_reference text)
returns text
language plpgsql volatile
set search_path = public
as $$
declare
  v_n integer;
begin
  select count(*) + 1 into v_n
    from refunds r
    join bookings b on b.id = r.booking_id
   where b.reference = p_booking_reference;
  return 'R' || p_booking_reference || '-' || v_n::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin cancellation, in every flavour the refund policy recognises.
--
-- p_trigger selects both the refund tier and the terminal status, so the two
-- can never be paired wrongly by a caller:
--
--   admin_cancel       time-based tiers   -> cancelled_by_admin   (slot freed)
--   companion_cancel   100%               -> cancelled_by_admin   (slot freed)
--   companion_no_show  100%               -> no_show_companion    (slot freed)
--   customer_no_show   0%                 -> no_show_customer     (slot held)
--   conduct_breach     0%                 -> ended_early          (slot held)
--
-- The last two keep the slot blocked on purpose: that hour was consumed, and
-- freeing it would let the same window be sold twice over.
-- ---------------------------------------------------------------------------

create or replace function ac_admin_cancel_booking(
  p_booking_id  uuid,
  p_admin_id    uuid,
  p_trigger     text,
  p_reason      text default null,
  p_incident_type        incident_type default null,
  p_incident_description text default null
)
returns jsonb
language plpgsql volatile
set search_path = public
as $$
declare
  v_booking   bookings%rowtype;
  v_quote     record;
  v_payment   payments%rowtype;
  v_status    booking_status;
  v_cancelled_by text;
  v_refund_id uuid;
  v_reference text;
  v_incident  uuid;
begin
  if p_trigger not in ('admin_cancel','companion_cancel','companion_no_show',
                       'customer_no_show','conduct_breach') then
    raise exception 'AC_UNKNOWN_TRIGGER';
  end if;

  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then
    raise exception 'AC_BOOKING_NOT_FOUND';
  end if;

  if v_booking.status not in ('pending_payment','confirmed','completed') then
    raise exception 'AC_NOT_CANCELLABLE';
  end if;

  -- T17 acceptance: ending a booking early always produces an incident record.
  -- Enforced here rather than in the UI so it holds for every caller.
  if p_trigger = 'conduct_breach'
     and coalesce(btrim(p_incident_description), '') = '' then
    raise exception 'AC_INCIDENT_REQUIRED';
  end if;

  v_status := case p_trigger
    when 'companion_no_show' then 'no_show_companion'
    when 'customer_no_show'  then 'no_show_customer'
    when 'conduct_breach'    then 'ended_early'
    else 'cancelled_by_admin'
  end;

  v_cancelled_by := case
    when p_trigger in ('companion_cancel','companion_no_show','conduct_breach')
    then 'companion' else 'admin'
  end;

  select * into v_quote
    from ac_refund_quote(
      p_booking_id,
      case when p_trigger = 'admin_cancel' then 'customer_cancel' else p_trigger end,
      now()
    );

  -- Only a captured payment can be refunded. An unpaid hold has nothing to
  -- return, whatever the tier says.
  select * into v_payment
    from payments
   where booking_id = p_booking_id
     and status in ('captured','partially_refunded')
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
    coalesce(nullif(btrim(coalesce(p_reason,'')), ''), p_trigger)
  );

  if coalesce(btrim(p_incident_description), '') <> '' then
    insert into incidents (
      booking_id, companion_id, customer_id, type, status, reported_by,
      description, ended_booking, refund_issued, created_by
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
    'to_status',         v_status,
    'tier_code',         v_quote.tier_code,
    'percent',           v_quote.percent,
    'refund_amount_paise', case when v_refund_id is null then 0 else v_quote.amount_paise end,
    'refund_id',         v_refund_id,
    'refund_reference',  v_reference,
    'incident_id',       v_incident,
    'cashfree_order_id', v_payment.cashfree_order_id
  );
end;
$$;

revoke execute on function ac_admin_cancel_booking(uuid, uuid, text, text, incident_type, text) from public, authenticated, anon;
grant  execute on function ac_admin_cancel_booking(uuid, uuid, text, text, incident_type, text) to service_role;

revoke execute on function ac_refund_reference(text) from public, authenticated, anon;
grant  execute on function ac_refund_reference(text) to service_role;

-- ---------------------------------------------------------------------------
-- Reviews tied to an open incident are never published automatically
-- (admin canvas, Reviews). Publishing is still possible, but only as a
-- deliberate act after the incident is resolved.
-- ---------------------------------------------------------------------------

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
       and i.status in ('open','investigating')
  );
$$;

revoke execute on function ac_review_publishable(uuid) from public, anon;
grant  execute on function ac_review_publishable(uuid) to authenticated, service_role;
