-- AlongCo — 0002_functions.sql
-- Pure/derived functions. Still no auth.* references, so the constraint and
-- pricing tests can run these against a plain Postgres.

-- ---------------------------------------------------------------------------
-- Settings accessors
-- ---------------------------------------------------------------------------

create or replace function ac_setting(p_key text)
returns jsonb
language sql stable
set search_path = public
as $$
  select value from settings where key = p_key;
$$;

create or replace function ac_setting_int(p_key text, p_default integer)
returns integer
language sql stable
set search_path = public
as $$
  select coalesce((select value #>> '{}' from settings where key = p_key)::integer, p_default);
$$;

-- ---------------------------------------------------------------------------
-- Booking reference — CLAUDE.md §6. Crockford-style, no I, O, 1 or 0, so a
-- reference read aloud over WhatsApp cannot be transcribed two ways.
-- ---------------------------------------------------------------------------

create or replace function ac_generate_reference()
returns text
language plpgsql volatile
set search_path = public
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  candidate text;
  i integer;
begin
  loop
    candidate := 'AC-';
    for i in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from bookings where reference = candidate);
  end loop;
  return candidate;
end;
$$;

-- ---------------------------------------------------------------------------
-- Pricing — CLAUDE.md §3.1/§3.2. Integer paise, no floats, computed here so the
-- client cannot influence it. lib/booking/pricing.ts mirrors this rule for
-- display, and tests/pricing-parity.test.ts asserts the two never drift.
--
-- Rounding: to the nearest rupee, which is what the design canvas price table
-- shows (2h ₹898 from ₹898.20; 3h ₹1,048 from ₹1,047.90).
-- ---------------------------------------------------------------------------

create or replace function ac_quote(p_rate_paise integer, p_minutes integer)
returns table (amount_paise integer, discount_percent smallint)
language plpgsql stable
set search_path = public
as $$
declare
  v_pct   smallint;
  v_gross numeric;
begin
  if p_rate_paise is null or p_rate_paise <= 0 then
    raise exception 'AC_INVALID_RATE';
  end if;
  if p_minutes is null or p_minutes <= 0 then
    raise exception 'AC_INVALID_DURATION';
  end if;

  select coalesce((
    select (d ->> 'percent')::smallint
    from settings s
    cross join lateral jsonb_array_elements(s.value) d
    where s.key = 'duration_discounts'
      and p_minutes >= (d ->> 'min_minutes')::integer
    order by (d ->> 'min_minutes')::integer desc
    limit 1
  ), 0) into v_pct;

  v_gross := p_rate_paise::numeric * p_minutes / 60;

  amount_paise     := (round(v_gross * (100 - v_pct) / 100 / 100) * 100)::integer;
  discount_percent := v_pct;

  if amount_paise <= 0 then
    raise exception 'AC_INVALID_AMOUNT';
  end if;

  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Availability inputs.
--
-- Returns the minimum a client needs to render a slot grid: the companion's
-- weekly rules, and bare busy/blackout windows with no reason, no customer and
-- no reference attached. Security definer so companion_blackouts and bookings
-- need no client-readable RLS policy at all.
--
-- The slot maths itself lives in lib/booking/availability.ts, pure and unit
-- tested (CLAUDE.md §4).
-- ---------------------------------------------------------------------------

create or replace function get_availability_inputs(
  p_companion_id uuid,
  p_from         timestamptz,
  p_to           timestamptz
)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_companion companions%rowtype;
begin
  select * into v_companion from companions where id = p_companion_id;
  if not found or not v_companion.is_active then
    return null;
  end if;

  return jsonb_build_object(
    'companion_id', v_companion.id,
    'is_accepting', v_companion.is_accepting,
    'hourly_rate_paise', v_companion.hourly_rate_paise,
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'weekday', weekday,
        'start_time', to_char(start_time, 'HH24:MI'),
        'end_time',   to_char(end_time,   'HH24:MI')
      ) order by weekday, start_time)
      from companion_availability where companion_id = p_companion_id
    ), '[]'::jsonb),
    'blackouts', coalesce((
      select jsonb_agg(jsonb_build_object('starts_at', starts_at, 'ends_at', ends_at) order by starts_at)
      from companion_blackouts
      where companion_id = p_companion_id
        and ends_at > p_from and starts_at < p_to
    ), '[]'::jsonb),
    -- Reserved period already includes each booking's trailing buffer.
    'busy', coalesce((
      select jsonb_agg(jsonb_build_object(
        'starts_at', lower(reserved_period),
        'ends_at',   upper(reserved_period)
      ) order by lower(reserved_period))
      from bookings
      where companion_id = p_companion_id
        and status in ('pending_payment','confirmed','completed','ended_early','no_show_customer','no_show_companion')
        and (status <> 'pending_payment' or hold_expires_at > now())
        and reserved_period && tstzrange(p_from, p_to, '[)')
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Booking status transitions always leave a trail. CLAUDE.md §6.
-- ---------------------------------------------------------------------------

create or replace function ac_set_booking_status(
  p_booking_id uuid,
  p_to         booking_status,
  p_actor_type text,
  p_actor_id   uuid default null,
  p_reason     text default null
)
returns booking_status
language plpgsql volatile
set search_path = public
as $$
declare
  v_from booking_status;
begin
  select status into v_from from bookings where id = p_booking_id for update;
  if not found then
    raise exception 'AC_BOOKING_NOT_FOUND';
  end if;

  if v_from = p_to then
    return v_from;   -- idempotent: a repeated webhook must not double-write
  end if;

  update bookings
     set status       = p_to,
         confirmed_at = case when p_to = 'confirmed' then coalesce(confirmed_at, now()) else confirmed_at end,
         completed_at = case when p_to = 'completed' then coalesce(completed_at, now()) else completed_at end
   where id = p_booking_id;

  insert into booking_events (booking_id, from_status, to_status, actor_type, actor_id, reason)
  values (p_booking_id, v_from, p_to, p_actor_type, p_actor_id, p_reason);

  return v_from;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cron support. Both are called from /api/cron/* after CRON_SECRET is verified.
-- ---------------------------------------------------------------------------

create or replace function ac_expire_holds()
returns integer
language plpgsql volatile
set search_path = public
as $$
declare
  v_id    uuid;
  v_count integer := 0;
begin
  for v_id in
    select id from bookings
     where status = 'pending_payment'
       and hold_expires_at is not null
       and hold_expires_at < now()
     for update skip locked
  loop
    perform ac_set_booking_status(v_id, 'expired', 'system', null, 'hold lapsed before payment');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function ac_complete_bookings()
returns integer
language plpgsql volatile
set search_path = public
as $$
declare
  v_id    uuid;
  v_count integer := 0;
begin
  for v_id in
    select id from bookings
     where status = 'confirmed'
       and ends_at < now()
     for update skip locked
  loop
    perform ac_set_booking_status(v_id, 'completed', 'system', null, 'end time passed');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Refund quote — PRD §6.9. Tiers come from settings, never from code (§3.10).
-- Returns the amount and the tier code that produced it, so the code can be
-- stored on the refund row for the dispute record.
-- ---------------------------------------------------------------------------

create or replace function ac_refund_quote(
  p_booking_id uuid,
  p_trigger    text default 'customer_cancel',
  p_now        timestamptz default now()
)
returns table (amount_paise integer, percent smallint, tier_code text)
language plpgsql stable
set search_path = public
as $$
declare
  v_booking  bookings%rowtype;
  v_hours    numeric;
  v_refunded integer;
  v_cap      integer;
begin
  select * into v_booking from bookings where id = p_booking_id;
  if not found then
    raise exception 'AC_BOOKING_NOT_FOUND';
  end if;

  -- Never refund more than was captured, across partial refunds (PRD §6.9).
  select coalesce(sum(r.amount_paise), 0) into v_refunded
    from refunds r where r.booking_id = p_booking_id and r.status <> 'failed';
  v_cap := v_booking.amount_paise - v_refunded;

  if p_trigger in ('companion_cancel', 'companion_no_show') then
    percent := 100; tier_code := 'companion_fault_full';
  elsif p_trigger = 'conduct_breach' then
    percent := 0;   tier_code := 'conduct_no_refund';
  elsif p_trigger = 'customer_no_show' then
    percent := 0;   tier_code := 'customer_no_show_none';
  else
    v_hours := extract(epoch from (v_booking.starts_at - p_now)) / 3600;
    select (t ->> 'percent')::smallint, t ->> 'code'
      into percent, tier_code
      from settings s
      cross join lateral jsonb_array_elements(s.value) t
     where s.key = 'refund_tiers'
       and v_hours >= (t ->> 'min_hours_before')::numeric
     order by (t ->> 'min_hours_before')::numeric desc
     limit 1;

    if percent is null then
      percent := 0; tier_code := 'under_24h_none';
    end if;
  end if;

  -- Exact paise, NOT rounded up to a whole rupee. A 50% refund of ₹499 is
  -- ₹249.50, which is what the admin canvas shows and what Cashfree will send
  -- back. Rounding to the rupee here would hand the customer ₹250 of a ₹499
  -- payment and leave the books half a rupee short on every odd cancellation.
  -- (Pricing does round to the rupee — see ac_quote. Different rule, on purpose.)
  amount_paise := least(
    round(v_booking.amount_paise::numeric * percent / 100)::integer,
    greatest(v_cap, 0)
  );
  return next;
end;
$$;
