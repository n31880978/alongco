-- AlongCo — 0012_provider_neutral_payments.sql
--
-- Payment columns stop naming a provider.
--
-- The schema has now been written for two gateways in succession — Razorpay in
-- the original sketch, then Cashfree, now Razorpay again. Each swap was a
-- migration plus a rename through every query, action and test that touched a
-- column. Naming the columns after the role they play rather than the vendor
-- filling it makes a third switch a configuration change.
--
-- `payment_provider` is stored per row, not read from the environment at query
-- time. A payment captured under one gateway must stay attributable to that
-- gateway forever — a refund six months later has to go back through whoever
-- actually took the money, and reconciliation has to survive the switch.

-- ---------------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------------

-- Renames are guarded. The hosted project applied part of this file before
-- failing partway, so a bare RENAME aborts there and takes the rest with it.
-- (Cashfree returned a payment_session_id to open its checkout; Razorpay opens
-- checkout with the order id itself, so provider_session_id stays nullable and
-- goes unused — kept because a future gateway may need the same handle.)
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('payments', 'cashfree_order_id',   'provider_order_id'),
      ('payments', 'cashfree_payment_id', 'provider_payment_id'),
      ('payments', 'payment_session_id',  'provider_session_id'),
      ('refunds',  'cashfree_refund_id',  'provider_refund_id')
    ) as t(tbl, old_name, new_name)
  loop
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name   = r.tbl
         and column_name  = r.old_name
    ) then
      execute format('alter table %I rename column %I to %I', r.tbl, r.old_name, r.new_name);
    end if;
  end loop;
end
$$;

alter table payments
  add column if not exists payment_provider text not null default 'razorpay';

alter table payments drop constraint if exists payments_provider_known;
alter table payments
  add constraint payments_provider_known
  check (payment_provider in ('razorpay', 'cashfree'));

-- Order ids are only guaranteed unique within a provider.
alter table payments drop constraint if exists payments_cashfree_order_id_key;
alter table payments drop constraint if exists payments_cashfree_payment_id_key;

create unique index if not exists payments_provider_order_key
  on payments (payment_provider, provider_order_id);
create unique index if not exists payments_provider_payment_key
  on payments (payment_provider, provider_payment_id)
  where provider_payment_id is not null;

-- ---------------------------------------------------------------------------
-- refunds
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- webhook_events
--
-- The (provider, event_id) unique constraint is what makes replay handling
-- work, and it already carried the provider. Only the default changes.
-- ---------------------------------------------------------------------------

alter table webhook_events alter column provider set default 'razorpay';

-- ---------------------------------------------------------------------------
-- ac_admin_cancel_booking returned cashfree_order_id by name. The refund path
-- reads that key, so it has to move with the column.
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
    'payment_provider',  v_payment.payment_provider,
    'provider_order_id', v_payment.provider_order_id,
    -- Razorpay refunds are issued against the PAYMENT, not the order, so the
    -- refund path needs this specifically. A captured payment always has one.
    'provider_payment_id', v_payment.provider_payment_id
  );
end;
$$;

revoke execute on function ac_admin_cancel_booking(uuid, uuid, text, text, incident_type, text)
  from public, anon, authenticated;
grant  execute on function ac_admin_cancel_booking(uuid, uuid, text, text, incident_type, text)
  to service_role;
