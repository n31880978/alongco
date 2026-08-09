-- AlongCo — 0001_init.sql
-- Schema, constraints, functions, seed. No auth.* references live here, so this
-- file also applies cleanly to a plain Postgres for the constraint tests.
--
-- Conventions: UUID PKs, timestamptz everywhere, money in integer paise.
-- Derived from docs/reference/schema-original.sql with these deliberate changes:
--   * Razorpay -> Cashfree throughout (CLAUDE.md §1, PRD §8 both specify Cashfree)
--   * confirmation dispatch, cancellation and payout columns added (PRD §6.8/6.9/6.11)
--   * refunds gained a status, because Cashfree refunds settle asynchronously
--   * review moderation metadata added (PRD §6.10)

create extension if not exists "pgcrypto";
create extension if not exists "btree_gist";   -- required by bookings_no_overlap

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type booking_status as enum (
  'pending_payment',      -- slot held, payment not captured
  'confirmed',
  'completed',
  'cancelled_by_customer',
  'cancelled_by_admin',
  'ended_early',          -- companion terminated the booking (see incidents)
  'no_show_customer',
  'no_show_companion',
  'expired'               -- hold lapsed before payment
);

create type payment_status  as enum ('created','authorized','captured','failed','refunded','partially_refunded');
create type refund_status   as enum ('created','pending','success','failed');
create type incident_type   as enum ('conduct_violation','safety_concern','no_show','payment_dispute','other');
create type incident_status as enum ('open','investigating','resolved','escalated');
create type ticket_status   as enum ('open','waiting_on_customer','resolved','closed');
create type payout_status   as enum ('owed','paid');

-- ---------------------------------------------------------------------------
-- Config — CLAUDE.md §3.10: these are read at runtime, never hardcoded.
-- ---------------------------------------------------------------------------

create table settings (
  key          text primary key,
  value        jsonb not null,
  is_public    boolean not null default false,  -- readable by anon; see 0002_rls
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);

insert into settings (key, value, is_public) values
  ('booking_window_days',  '7',    true),
  ('buffer_minutes',       '15',   true),
  ('min_duration_minutes', '60',   true),
  ('hold_minutes',         '10',   true),
  ('service_hours',        '{"start":"08:00","end":"22:00"}', true),
  ('timezone',             '"Asia/Kolkata"', true),
  -- Confirmed against the design canvas price table: 1h ₹499, 2h ₹898 (−10%),
  -- 3h+ ₹1,048 (−30%). Matched descending, first hit wins.
  ('duration_discounts',   '[{"min_minutes":180,"percent":30},
                             {"min_minutes":120,"percent":10},
                             {"min_minutes":60,"percent":0}]', true),
  ('refund_tiers',         '[{"min_hours_before":48,"percent":100,"code":"48h_full"},
                             {"min_hours_before":24,"percent":50,"code":"24h_half"},
                             {"min_hours_before":0,"percent":0,"code":"under_24h_none"}]', true),
  ('terms_version',        '"2026-08-01"', true),
  ('confirmation_sla_minutes', '15', false),
  ('max_active_holds',     '3', false),
  ('grievance_contact',    '{"name":"Grievance Officer","email":"privacy@alongco.com"}', true);

create table areas (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  is_active  boolean not null default true,
  sort_order integer not null default 0
);

insert into areas (name, sort_order) values
  ('MG Road', 1), ('Indiranagar', 2), ('Cubbon Park', 3);

-- ---------------------------------------------------------------------------
-- Companions
-- ---------------------------------------------------------------------------

create table companions (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  display_name      text not null,                 -- PSEUDONYM. The only name a client ever sees.
  bio               text,
  photo_path        text,                          -- key in the companion-photos bucket
  hourly_rate_paise integer not null check (hourly_rate_paise > 0),
  is_active         boolean not null default false,
  is_accepting      boolean not null default true, -- soft pause without deactivating
  created_at        timestamptz not null default now()
);

-- Real identity. Separate table so it is locked down independently and cannot
-- be leaked by a careless `select *` on companions. CLAUDE.md §3.6.
create table companion_identities (
  companion_id        uuid primary key references companions(id) on delete cascade,
  legal_name          text not null,
  phone               text not null,
  id_document_path    text,                  -- companion-docs bucket, private
  vetted_at           timestamptz,
  vetted_by           uuid,
  vetting_notes       text,
  agreement_signed_at timestamptz            -- conduct agreement with the operator
);

create table companion_availability (
  id           uuid primary key default gen_random_uuid(),
  companion_id uuid not null references companions(id) on delete cascade,
  weekday      smallint not null check (weekday between 0 and 6),  -- 0 = Sunday, IST
  start_time   time not null,
  end_time     time not null,
  check (end_time > start_time)
);
create index on companion_availability (companion_id, weekday);

create table companion_blackouts (
  id           uuid primary key default gen_random_uuid(),
  companion_id uuid not null references companions(id) on delete cascade,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  reason       text,                          -- internal only, never sent to a client
  check (ends_at > starts_at)
);
create index on companion_blackouts (companion_id, starts_at);

create table companion_areas (
  companion_id uuid references companions(id) on delete cascade,
  area_id      uuid references areas(id) on delete cascade,
  primary key (companion_id, area_id)
);

-- ---------------------------------------------------------------------------
-- Customers  (DPDP: collect the minimum, record consent, support deletion)
-- ---------------------------------------------------------------------------

create table customers (
  id                    uuid primary key default gen_random_uuid(),
  auth_user_id          uuid unique,          -- auth.users.id
  phone                 text not null unique,
  full_name             text,
  consent_version       text,
  consent_at            timestamptz,
  is_blocked            boolean not null default false,
  block_reason          text,
  created_at            timestamptz not null default now(),
  deletion_requested_at timestamptz           -- DPDP erasure request; drives the purge job
);

-- ---------------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------------

create table bookings (
  id                  uuid primary key default gen_random_uuid(),
  reference           text not null unique,   -- human-facing, e.g. AC-7F3K2M; goes on the ticket/QR
  customer_id         uuid not null references customers(id),
  companion_id        uuid not null references companions(id),
  area_id             uuid not null references areas(id),

  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  buffer_minutes      integer not null default 15,

  -- Reserved window = booking + trailing buffer.
  --
  -- The original schema declared this GENERATED ALWAYS. Postgres rejects that:
  -- `timestamptz + interval` is STABLE, not IMMUTABLE (adding an interval can
  -- cross a DST boundary, so the result depends on the session TimeZone), and a
  -- generated column requires an immutable expression. The trigger below
  -- recomputes it on every insert and every update regardless of what the
  -- statement supplied, which gives the same "cannot drift" guarantee.
  reserved_period     tstzrange not null,

  status              booking_status not null default 'pending_payment',
  hold_expires_at     timestamptz,            -- set on creation; cron expires stale holds

  amount_paise        integer not null check (amount_paise > 0),
  rate_snapshot_paise integer not null,       -- rate at time of booking; rates change
  discount_percent    smallint not null default 0,

  -- Terms accepted at checkout. Without these the conduct policy is
  -- unenforceable, so both are NOT NULL. CLAUDE.md §3.8.
  terms_version       text not null,
  terms_accepted_at   timestamptz not null default now(),

  customer_notes      text,

  -- Manual WhatsApp dispatch (PRD §6.8). Flagged in the queue past the SLA.
  confirmation_sent_at timestamptz,
  confirmation_sent_by uuid,

  -- Cancellation record (PRD §6.9). refund_tier_applied is the settings code.
  cancelled_at        timestamptz,
  cancelled_by        text check (cancelled_by in ('customer','admin','companion')),
  cancellation_reason text,
  refund_tier_applied text,

  completed_at        timestamptz,
  confirmed_at        timestamptz,
  created_at          timestamptz not null default now(),

  check (ends_at > starts_at),
  -- Safety net only. The authoritative minimum is settings.min_duration_minutes,
  -- enforced in create_booking_hold. Raise both together if it ever changes.
  check (ends_at - starts_at >= interval '60 minutes')
);

-- Always derived, never supplied. Fires on INSERT and on every UPDATE, so a
-- statement that tries to set reserved_period directly is silently overridden.
create or replace function ac_sync_reserved_period()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.reserved_period := tstzrange(
    new.starts_at,
    new.ends_at + make_interval(mins => new.buffer_minutes),
    '[)'
  );
  return new;
end;
$$;

create trigger bookings_sync_reserved_period
  before insert or update on bookings
  for each row execute function ac_sync_reserved_period();

-- THE important constraint. Two live bookings can never overlap for the same
-- companion, buffer included — enforced in the database, not the UI. §3.5.
-- Statuses absent from this list free the slot: cancelled_*, expired.
alter table bookings add constraint bookings_no_overlap
  exclude using gist (
    companion_id with =,
    reserved_period with &&
  ) where (status in ('pending_payment','confirmed','completed','ended_early','no_show_customer','no_show_companion'));

create index on bookings (customer_id, starts_at desc);
create index on bookings (companion_id, starts_at);
create index on bookings (status, hold_expires_at) where status = 'pending_payment';
create index on bookings (status, ends_at) where status = 'confirmed';
create index on bookings (confirmation_sent_at) where status = 'confirmed';

create table booking_events (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references bookings(id) on delete cascade,
  from_status booking_status,
  to_status   booking_status not null,
  actor_type  text not null check (actor_type in ('customer','companion','admin','system')),
  actor_id    uuid,
  reason      text,
  created_at  timestamptz not null default now()
);
create index on booking_events (booking_id, created_at);

-- ---------------------------------------------------------------------------
-- Payments — Cashfree PG, API version 2025-01-01
-- ---------------------------------------------------------------------------

create table payments (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid not null references bookings(id),
  -- Cashfree's order_id is our idempotency handle for a checkout attempt. A
  -- booking may have several: PRD §6.6 requires retry to resume the booking.
  cashfree_order_id   text not null unique,
  cashfree_payment_id text unique,
  payment_session_id  text,                  -- returned by order create; opens checkout
  amount_paise        integer not null check (amount_paise > 0),
  status              payment_status not null default 'created',
  method              text,                  -- 'upi' | 'card' | ... never the instrument itself
  failure_reason      text,
  created_at          timestamptz not null default now(),
  captured_at         timestamptz
);
create index on payments (booking_id, created_at desc);

create table refunds (
  id                 uuid primary key default gen_random_uuid(),
  payment_id         uuid not null references payments(id),
  booking_id         uuid not null references bookings(id),
  cashfree_refund_id text unique,
  refund_reference   text not null unique,   -- our idempotent refund_id sent to Cashfree
  amount_paise       integer not null check (amount_paise > 0),
  status             refund_status not null default 'created',
  tier_applied       text,                   -- settings code: '48h_full', 'companion_cancelled', ...
  initiated_by       uuid,
  notes              text,
  created_at         timestamptz not null default now(),
  settled_at         timestamptz
);
create index on refunds (booking_id);

-- Cashfree retries webhooks. Store the event id and ignore repeats. §3.4.
create table webhook_events (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null default 'cashfree',
  event_id     text not null,
  event_type   text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  process_error text,
  unique (provider, event_id)
);

-- Manual payouts to companions (PRD §6.11). Automated payouts are a v2 non-goal.
create table payouts (
  id           uuid primary key default gen_random_uuid(),
  companion_id uuid not null references companions(id),
  period_start date not null,
  period_end   date not null,
  amount_paise integer not null check (amount_paise > 0),
  status       payout_status not null default 'owed',
  utr_reference text,                        -- bank UTR, recorded when marked paid
  paid_at      timestamptz,
  paid_by      uuid,
  notes        text,
  created_at   timestamptz not null default now(),
  check (period_end >= period_start)
);
create index on payouts (companion_id, period_start);

-- ---------------------------------------------------------------------------
-- Reviews — one per completed booking. This is what "verified review" means,
-- and it is never a claim about the companion. CLAUDE.md §3.7.
-- ---------------------------------------------------------------------------

create table reviews (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null unique references bookings(id),
  customer_id    uuid not null references customers(id),
  companion_id   uuid not null references companions(id),
  rating         smallint not null check (rating between 1 and 5),
  body           text,
  is_published   boolean not null default false,   -- admin moderation
  moderated_at   timestamptz,
  moderated_by   uuid,
  moderation_note text,
  created_at     timestamptz not null default now()
);
create index on reviews (companion_id) where is_published;

-- ---------------------------------------------------------------------------
-- Incidents & support
-- ---------------------------------------------------------------------------

create table incidents (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid references bookings(id),
  companion_id   uuid references companions(id),
  customer_id    uuid references customers(id),
  type           incident_type not null,
  status         incident_status not null default 'open',
  reported_by    text not null check (reported_by in ('customer','companion','admin')),
  description    text not null,
  action_taken   text,
  ended_booking  boolean not null default false,
  refund_issued  boolean not null default false,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  resolved_at    timestamptz,
  resolved_by    uuid
);
create index on incidents (booking_id);
create index on incidents (status, created_at desc);

create table support_tickets (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id),
  booking_id  uuid references bookings(id),
  subject     text not null,
  status      ticket_status not null default 'open',
  assigned_to uuid,
  created_at  timestamptz not null default now()
);

create table support_messages (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references support_tickets(id) on delete cascade,
  author     text not null check (author in ('customer','admin')),
  body       text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------

create table admin_users (
  id         uuid primary key,              -- auth.users.id
  email      text not null unique,
  role       text not null check (role in ('owner','ops','support')),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table admin_audit_log (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid not null references admin_users(id),
  action      text not null,                -- 'refund.issue', 'companion.deactivate', ...
  entity_type text not null,
  entity_id   uuid,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);
create index on admin_audit_log (created_at desc);

-- OTP throttling (PRD §6.3). Supabase Auth has its own limits; this adds the
-- per-phone and per-IP window the acceptance criteria ask for.
create table otp_requests (
  id           uuid primary key default gen_random_uuid(),
  phone_hash   text not null,               -- sha256(phone). Never the number itself. §9
  ip_hash      text not null,
  requested_at timestamptz not null default now()
);
create index on otp_requests (phone_hash, requested_at desc);
create index on otp_requests (ip_hash, requested_at desc);
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
-- AlongCo — 0003_rls.sql
-- Row level security and the auth-dependent RPCs.
--
-- CLAUDE.md §3.9: RLS on for every table, deny by default. A table with RLS
-- enabled and no policy is readable only by service_role — that is the intended
-- state for identities, payments, refunds, incidents and the audit log.

-- ---------------------------------------------------------------------------
-- Enable on everything. No exceptions.
-- ---------------------------------------------------------------------------

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
alter table otp_requests           enable row level security;

-- Force RLS on the tables whose whole point is that nobody sees them, so even a
-- table owner connection is subject to policy.
alter table companion_identities   force row level security;
alter table payments               force row level security;
alter table refunds                force row level security;
alter table admin_audit_log        force row level security;

-- ---------------------------------------------------------------------------
-- Public, read-only surfaces
-- ---------------------------------------------------------------------------

create policy settings_public_read on settings
  for select to anon, authenticated using (is_public);

create policy areas_public_read on areas
  for select to anon, authenticated using (is_active);

-- An inactive companion does not exist to a visitor: no listing, and the
-- profile 404s because this returns no row (PRD §6.1).
create policy companions_public_read on companions
  for select to anon, authenticated using (is_active);

create policy companion_availability_public_read on companion_availability
  for select to anon, authenticated
  using (exists (select 1 from companions c
                  where c.id = companion_availability.companion_id and c.is_active));

create policy companion_areas_public_read on companion_areas
  for select to anon, authenticated
  using (exists (select 1 from companions c
                  where c.id = companion_areas.companion_id and c.is_active));

-- companion_identities: NO POLICY, BY DESIGN. CLAUDE.md §3.6.
-- companion_blackouts: NO POLICY. Reached only via get_availability_inputs,
--   which strips the reason text.

-- ---------------------------------------------------------------------------
-- Customer-owned rows
-- ---------------------------------------------------------------------------

create policy customers_select_own on customers
  for select to authenticated using (auth_user_id = (select auth.uid()));

-- Deliberately no UPDATE policy. If customers could update their own row they
-- could clear is_blocked. Profile edits go through ac_set_customer_profile.

create policy bookings_select_own on bookings
  for select to authenticated
  using (exists (select 1 from customers c
                  where c.id = bookings.customer_id
                    and c.auth_user_id = (select auth.uid())));

-- No INSERT policy: booking creation is create_booking_hold only (§3.9).
-- No UPDATE policy: status changes are server-side only (§3.3).

create policy booking_events_select_own on booking_events
  for select to authenticated
  using (exists (select 1 from bookings b
                   join customers c on c.id = b.customer_id
                  where b.id = booking_events.booking_id
                    and c.auth_user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Reviews — "verified" means tied to a completed booking, nothing more (§3.7)
-- ---------------------------------------------------------------------------

create policy reviews_public_read on reviews
  for select to anon, authenticated using (is_published);

create policy reviews_select_own on reviews
  for select to authenticated
  using (exists (select 1 from customers c
                  where c.id = reviews.customer_id
                    and c.auth_user_id = (select auth.uid())));

create policy reviews_insert_own on reviews
  for insert to authenticated
  with check (
    is_published = false                       -- publication is a moderator's act
    and exists (
      select 1
        from bookings b
        join customers c on c.id = b.customer_id
       where b.id = reviews.booking_id
         and c.auth_user_id = (select auth.uid())
         and c.id = reviews.customer_id
         and b.companion_id = reviews.companion_id
         and b.status = 'completed'
         and b.ends_at < now()
    )
  );

-- payments, refunds, webhook_events, payouts, incidents, support_*,
-- admin_users, admin_audit_log, otp_requests: RLS on, no policies.
-- service_role only. Clients read payment state through their booking.

-- ---------------------------------------------------------------------------
-- Customer bootstrap. Phone comes from the verified JWT, never from an
-- argument, so a caller cannot claim someone else's number.
-- ---------------------------------------------------------------------------

create or replace function ac_ensure_customer(p_consent_version text default null)
returns uuid
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_phone text := auth.jwt() ->> 'phone';
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'AC_NOT_AUTHENTICATED';
  end if;
  if v_phone is null or v_phone = '' then
    raise exception 'AC_NO_PHONE_CLAIM';
  end if;

  -- Normalise to E.164 without the leading '+', matching what Supabase issues.
  v_phone := regexp_replace(v_phone, '[^0-9]', '', 'g');

  select id into v_id from customers where auth_user_id = v_uid;
  if found then
    if p_consent_version is not null then
      update customers
         set consent_version = p_consent_version,
             consent_at      = coalesce(consent_at, now())
       where id = v_id and consent_version is distinct from p_consent_version;
    end if;
    return v_id;
  end if;

  -- Same number returning on a new auth user: adopt the existing record rather
  -- than orphaning her booking history.
  select id into v_id from customers where phone = v_phone;
  if found then
    update customers set auth_user_id = v_uid where id = v_id;
    return v_id;
  end if;

  insert into customers (auth_user_id, phone, consent_version, consent_at)
  values (v_uid, v_phone, p_consent_version,
          case when p_consent_version is null then null else now() end)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function ac_set_customer_profile(p_full_name text)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AC_NOT_AUTHENTICATED';
  end if;
  if p_full_name is null or length(btrim(p_full_name)) < 2 then
    raise exception 'AC_INVALID_NAME';
  end if;

  update customers
     set full_name = btrim(p_full_name)
   where auth_user_id = v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_booking_hold — the only way a booking row comes into existence.
--
-- Everything that decides money or time is computed here: the amount from the
-- companion's current rate, the hold TTL and buffer from settings, the window
-- from settings. The caller supplies a slot and a duration and nothing else
-- that matters. CLAUDE.md §3.1, §3.9.
--
-- Raises AC_* messages the server action maps to specific user-facing copy,
-- because "something went wrong" on the slot path is forbidden (§6).
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
  select * into v_customer from customers where auth_user_id = auth.uid();
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

-- ---------------------------------------------------------------------------
-- Execute grants. Default PUBLIC EXECUTE is revoked first; nothing is callable
-- by a role that has no business calling it.
-- ---------------------------------------------------------------------------

revoke execute on function ac_setting(text)                                        from public;
revoke execute on function ac_setting_int(text, integer)                           from public;
revoke execute on function ac_generate_reference()                                 from public;
revoke execute on function ac_quote(integer, integer)                              from public;
revoke execute on function get_availability_inputs(uuid, timestamptz, timestamptz) from public;
revoke execute on function ac_set_booking_status(uuid, booking_status, text, uuid, text) from public;
revoke execute on function ac_expire_holds()                                       from public;
revoke execute on function ac_complete_bookings()                                  from public;
revoke execute on function ac_refund_quote(uuid, text, timestamptz)                from public;
revoke execute on function ac_ensure_customer(text)                                from public;
revoke execute on function ac_set_customer_profile(text)                           from public;
revoke execute on function create_booking_hold(text, timestamptz, integer, uuid, text, text) from public;

grant execute on function ac_quote(integer, integer)                              to anon, authenticated, service_role;
grant execute on function get_availability_inputs(uuid, timestamptz, timestamptz) to anon, authenticated, service_role;
grant execute on function ac_ensure_customer(text)                                to authenticated, service_role;
grant execute on function ac_set_customer_profile(text)                           to authenticated, service_role;
grant execute on function create_booking_hold(text, timestamptz, integer, uuid, text, text) to authenticated, service_role;

grant execute on function ac_setting(text)                                        to service_role;
grant execute on function ac_setting_int(text, integer)                           to service_role;
grant execute on function ac_generate_reference()                                 to service_role;
grant execute on function ac_set_booking_status(uuid, booking_status, text, uuid, text) to service_role;
grant execute on function ac_expire_holds()                                       to service_role;
grant execute on function ac_complete_bookings()                                  to service_role;
grant execute on function ac_refund_quote(uuid, text, timestamptz)                to service_role;
-- AlongCo — 0004_storage.sql
-- Supabase Storage buckets and their policies. Skipped by the local plain-Postgres
-- harness, which has no storage schema.

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema absent — skipping bucket setup';
    return;
  end if;

  -- Profile photos are meant to be seen. Public bucket, CDN-cacheable.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('companion-photos', 'companion-photos', true, 5242880,
          array['image/jpeg','image/png','image/webp'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- ID documents. Private, service_role only. CLAUDE.md §3.6 — no client policy
  -- is created for this bucket, deliberately.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('companion-docs', 'companion-docs', false, 10485760,
          array['image/jpeg','image/png','application/pdf'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
end
$$;

do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  drop policy if exists companion_photos_public_read on storage.objects;
  create policy companion_photos_public_read on storage.objects
    for select to anon, authenticated
    using (bucket_id = 'companion-photos');

  -- Uploads go through admin server actions on the service client, so there is
  -- no insert/update/delete policy for anon or authenticated on either bucket.
end
$$;
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
-- AlongCo — 0006_otp_rate_limit.sql
--
-- The OTP request happens before a customer has a session. This narrowly scoped
-- RPC records only salted hashes and enforces the limits without granting the
-- browser (or the server action) direct access to otp_requests. It removes the
-- need for SUPABASE_SERVICE_ROLE_KEY in the sign-in flow.

create or replace function ac_consume_otp_rate_limit(
  p_phone_hash text,
  p_ip_hash    text
)
returns table (allowed boolean, retry_after_seconds integer, scope text)
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_phone_lock text := 'otp-phone:' || p_phone_hash;
  v_ip_lock    text := 'otp-ip:' || p_ip_hash;
  v_minute_count integer;
  v_phone_hour_count integer;
  v_ip_hour_count integer;
begin
  -- The hashes are SHA-256 hex values created on the server with OTP_HASH_SALT.
  -- Reject arbitrary payloads before they can become retained data.
  if p_phone_hash !~ '^[a-f0-9]{64}$' or p_ip_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'AC_INVALID_RATE_LIMIT_KEY';
  end if;

  -- Serialize requests that share either limiting key. Without these locks,
  -- concurrent sixth requests could both observe a count of four and slip past
  -- the limit before either one inserts its row.
  if v_phone_lock < v_ip_lock then
    perform pg_advisory_xact_lock(hashtextextended(v_phone_lock, 0));
    perform pg_advisory_xact_lock(hashtextextended(v_ip_lock, 0));
  else
    perform pg_advisory_xact_lock(hashtextextended(v_ip_lock, 0));
    perform pg_advisory_xact_lock(hashtextextended(v_phone_lock, 0));
  end if;

  select count(*) into v_minute_count
    from otp_requests
   where phone_hash = p_phone_hash
     and requested_at >= now() - interval '1 minute';

  if v_minute_count >= 5 then
    return query select false, 60, 'phone';
    return;
  end if;

  select count(*) into v_phone_hour_count
    from otp_requests
   where phone_hash = p_phone_hash
     and requested_at >= now() - interval '1 hour';

  if v_phone_hour_count >= 10 then
    return query select false, 3600, 'phone';
    return;
  end if;

  select count(*) into v_ip_hour_count
    from otp_requests
   where ip_hash = p_ip_hash
     and requested_at >= now() - interval '1 hour';

  if v_ip_hour_count >= 20 then
    return query select false, 3600, 'ip';
    return;
  end if;

  insert into otp_requests (phone_hash, ip_hash) values (p_phone_hash, p_ip_hash);

  -- Hashes are not retained beyond the useful abuse-prevention window.
  delete from otp_requests where requested_at < now() - interval '24 hours';

  return query select true, 0, null::text;
end;
$$;

revoke all on function ac_consume_otp_rate_limit(text, text) from public;
grant execute on function ac_consume_otp_rate_limit(text, text) to anon, authenticated;
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
-- AlongCo — 0008_action_rate_limit.sql
--
-- TASKS T21. OTP already has its own limiter (0006), which is keyed on hashes
-- because it runs before there is a session. Booking creation and review
-- submission both happen *after* authentication, so they can be limited per
-- customer, which is both simpler and harder to evade than an IP limit.
--
-- The counters are derived from the rows the actions already write — there is no
-- separate counter table to keep in step, and nothing new is retained about her.

create or replace function ac_check_action_rate_limit(
  p_action text,
  p_customer_id uuid
)
returns table (allowed boolean, retry_after_seconds integer, reason text)
language plpgsql volatile
set search_path = public
as $$
declare
  v_recent integer;
  v_lock text := 'ac-action:' || p_action || ':' || p_customer_id::text;
begin
  -- Serialize per customer per action, so two concurrent submissions cannot both
  -- read the same count and both slip through.
  perform pg_advisory_xact_lock(hashtextextended(v_lock, 0));

  if p_action = 'booking_hold' then
    -- Holds block a companion's slot for ten minutes. Someone cycling through
    -- holds without paying can take a whole day off the market, so the limit is
    -- on *unpaid* holds — paying for one and booking another is not abuse.
    select count(*) into v_recent
      from bookings
     where customer_id = p_customer_id
       and status in ('pending_payment', 'expired')
       and created_at >= now() - interval '1 hour';

    if v_recent >= 8 then
      return query select false, 3600,
        'Too many holds without payment. Try again in an hour, or call us and we will book it by hand.'::text;
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
    -- One review per booking is already enforced by a unique constraint. This
    -- is about someone hammering the endpoint, not about duplicate reviews.
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
grant execute on function ac_check_action_rate_limit(text, uuid) to authenticated, service_role;
-- AlongCo — 0009_function_grants.sql
--
-- Asserts, explicitly and in one place, which roles may execute which function.
--
-- Why this exists: the hosted project was found with `anon` and `authenticated`
-- holding EXECUTE on functions that are server-side machinery — including
-- ac_set_booking_status, which is what marks a booking confirmed. A blanket
-- `grant execute on all functions` had been applied at some point, silently
-- widening what the earlier migrations had deliberately revoked.
--
-- Nothing was exploitable at the time it was found: `bookings` has no UPDATE
-- policy, so ac_set_booking_status's `select … for update` is filtered out by
-- RLS and raises AC_BOOKING_NOT_FOUND. But that is defence by accident. It holds
-- only until someone adds an UPDATE policy for a good reason, and then a
-- signed-in customer can confirm her own booking without paying.
--
-- PUBLIC holds EXECUTE on new functions by default, so every entry revokes from
-- public first and then grants only what is needed.

-- ---------------------------------------------------------------------------
-- Server-side only. No client role ever calls these.
--
-- SECURITY DEFINER functions call them internally and run as their owner, so
-- revoking here does not break create_booking_hold, ac_cancel_own_booking or
-- any other customer-facing path.
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'ac_set_booking_status(uuid, booking_status, text, uuid, text)',
    'ac_refund_quote(uuid, text, timestamptz)',
    'ac_expire_holds()',
    'ac_complete_bookings()',
    'ac_quote(integer, integer)',
    'ac_generate_reference()',
    'ac_setting(text)',
    'ac_setting_int(text, integer)'
  ]
  loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', fn);
      execute format('grant  execute on function %s to service_role', fn);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Customer-facing. Each of these checks auth.uid() itself and raises
-- AC_NOT_AUTHENTICATED, so `anon` has nothing to gain — but it is revoked
-- anyway, so the refusal is a permission error rather than a business-logic
-- error that happens to be correct.
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'create_booking_hold(text, timestamptz, integer, uuid, text, text)',
    'ac_ensure_customer(text)',
    'ac_set_customer_profile(text)',
    'ac_set_booking_details(uuid, text, uuid, text)',
    'ac_cancel_own_booking(uuid, text)',
    'ac_quote_own_cancellation(uuid)',
    'ac_check_action_rate_limit(text, uuid)',
    'ac_review_publishable(uuid)'
  ]
  loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from public, anon', fn);
      execute format('grant  execute on function %s to authenticated, service_role', fn);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Genuinely public.
--
-- get_availability_inputs backs the slot picker before sign-in, and the OTP
-- limiter necessarily runs before there is a session at all.
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'get_availability_inputs(uuid, timestamptz, timestamptz)',
    'ac_consume_otp_rate_limit(text, text)'
  ]
  loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from public', fn);
      execute format('grant  execute on function %s to anon, authenticated, service_role', fn);
    end if;
  end loop;
end
$$;

-- Admin machinery: service_role and nothing else.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'ac_admin_cancel_booking(uuid, uuid, text, text, incident_type, text)',
    'ac_refund_reference(text)'
  ]
  loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', fn);
      execute format('grant  execute on function %s to service_role', fn);
    end if;
  end loop;
end
$$;
-- AlongCo — 0010_admin_login.sql
--
-- Admin sign-in is email + password, deliberately a different credential class
-- from the customer's phone OTP. A password endpoint is guessable in a way an
-- OTP flow is not, so it gets its own throttle.
--
-- Nothing reversible is stored: the email and IP are salted SHA-256 hashes
-- created on the server, the same treatment OTP requests get (CLAUDE.md §9).

create table if not exists admin_login_attempts (
  id           uuid primary key default gen_random_uuid(),
  email_hash   text not null,
  ip_hash      text not null,
  succeeded    boolean not null default false,
  attempted_at timestamptz not null default now()
);

create index if not exists admin_login_attempts_email_idx
  on admin_login_attempts (email_hash, attempted_at desc);
create index if not exists admin_login_attempts_ip_idx
  on admin_login_attempts (ip_hash, attempted_at desc);

alter table admin_login_attempts enable row level security;
-- No policy, deliberately. Only the service role touches this.

-- ---------------------------------------------------------------------------
-- Consume one attempt. Returns whether to proceed.
--
-- Counts only FAILED attempts in the window, so a working admin signing in
-- repeatedly is never locked out by their own success.
-- ---------------------------------------------------------------------------

create or replace function ac_consume_admin_login_attempt(
  p_email_hash text,
  p_ip_hash    text
)
returns table (allowed boolean, retry_after_seconds integer, scope text)
language plpgsql volatile
set search_path = public
as $$
declare
  v_email_fails integer;
  v_ip_fails    integer;
  v_email_lock  text := 'admin-login-email:' || p_email_hash;
  v_ip_lock     text := 'admin-login-ip:' || p_ip_hash;
begin
  if p_email_hash !~ '^[a-f0-9]{64}$' or p_ip_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'AC_INVALID_RATE_LIMIT_KEY';
  end if;

  -- Ordered consistently so two concurrent attempts cannot deadlock.
  if v_email_lock < v_ip_lock then
    perform pg_advisory_xact_lock(hashtextextended(v_email_lock, 0));
    perform pg_advisory_xact_lock(hashtextextended(v_ip_lock, 0));
  else
    perform pg_advisory_xact_lock(hashtextextended(v_ip_lock, 0));
    perform pg_advisory_xact_lock(hashtextextended(v_email_lock, 0));
  end if;

  select count(*) into v_email_fails
    from admin_login_attempts
   where email_hash = p_email_hash
     and not succeeded
     and attempted_at >= now() - interval '15 minutes';

  if v_email_fails >= 5 then
    return query select false, 900, 'email'::text;
    return;
  end if;

  select count(*) into v_ip_fails
    from admin_login_attempts
   where ip_hash = p_ip_hash
     and not succeeded
     and attempted_at >= now() - interval '15 minutes';

  if v_ip_fails >= 15 then
    return query select false, 900, 'ip'::text;
    return;
  end if;

  return query select true, 0, null::text;
end;
$$;

create or replace function ac_record_admin_login_attempt(
  p_email_hash text,
  p_ip_hash    text,
  p_succeeded  boolean
)
returns void
language plpgsql volatile
set search_path = public
as $$
begin
  if p_email_hash !~ '^[a-f0-9]{64}$' or p_ip_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'AC_INVALID_RATE_LIMIT_KEY';
  end if;

  insert into admin_login_attempts (email_hash, ip_hash, succeeded)
  values (p_email_hash, p_ip_hash, p_succeeded);

  -- Hashes are not kept beyond the useful window.
  delete from admin_login_attempts where attempted_at < now() - interval '7 days';
end;
$$;

revoke all on function ac_consume_admin_login_attempt(text, text) from public, anon, authenticated;
grant execute on function ac_consume_admin_login_attempt(text, text) to service_role;

revoke all on function ac_record_admin_login_attempt(text, text, boolean) from public, anon, authenticated;
grant execute on function ac_record_admin_login_attempt(text, text, boolean) to service_role;
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
-- AlongCo — 0014_pg_cron_schedules.sql
--
-- Scheduling moves into Postgres. CLAUDE.md §8 named Vercel Cron; this replaces
-- it, and the reason is not preference — the HTTP approach could not be made to
-- work on the plan this project is on:
--
--   · Vercel Cron on Hobby is capped at one invocation per day. expire-holds
--     has to run every minute, because a hold lasts ten. Daily means a slot can
--     sit wrongly held for most of a day, which fails the PRD §6.4 criterion
--     outright ("an 11-minute-old hold is expired and its slot is bookable
--     again").
--   · The GitHub Actions fallback failed every run: it called the apex, which
--     308-redirects to www, and CRON_SECRET was never added to the repo secrets
--     so the bearer token was empty and the route answered 401. Two separate
--     faults, both invisible until someone read the failure emails.
--
-- pg_cron removes the whole class of problem. Both jobs are already single SQL
-- function calls, so there is nothing for HTTP to add:
--
--   · no hostname to get wrong, and no redirect to follow
--   · no shared secret to set in two places and keep in step
--   · no hosting plan limit — this is Postgres, not the web tier
--   · no coupling to the host at all, so moving off Vercel changes nothing
--
-- The /api/cron/* routes stay. They are still the way to trigger a run by hand
-- when investigating something, and they still verify CRON_SECRET.

-- ---------------------------------------------------------------------------
-- Scheduling, guarded.
--
-- pg_cron ships with Supabase but not with a plain local Postgres, and the test
-- database is a plain local Postgres (scripts/db-reset.sh). Skipping when the
-- extension is unavailable keeps `npm run db:reset` working — the same shape
-- 0004_storage.sql uses for the storage schema. The scheduled work itself is
-- tested directly by calling ac_expire_holds() and ac_complete_bookings(), so
-- nothing goes unverified because of the skip.
--
-- Unscheduling first makes this safe to re-run on any pg_cron version and
-- leaves no chance of a stale duplicate under a slightly different name.
-- ---------------------------------------------------------------------------

do $$
declare
  j text;
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron unavailable — skipping schedule setup (expected on a plain local Postgres)';
    return;
  end if;

  create extension if not exists pg_cron;

  foreach j in array array['ac-expire-holds', 'ac-complete-bookings']
  loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(j);
    end if;
  end loop;

  -- Every minute: pending_payment past hold_expires_at -> expired, which
  -- returns the slot to availability. ac_expire_holds() uses FOR UPDATE SKIP
  -- LOCKED, so an overrun run cannot expire the same booking twice.
  perform cron.schedule(
    'ac-expire-holds',
    '* * * * *',
    'select public.ac_expire_holds();'
  );

  -- Hourly, on the hour: confirmed bookings past ends_at -> completed. This is
  -- what makes a booking reviewable (PRD §6.10).
  perform cron.schedule(
    'ac-complete-bookings',
    '0 * * * *',
    'select public.ac_complete_bookings();'
  );
end
$$;
-- AlongCo — 0015_cleanup_otp_functions.sql
--
-- Customer sign-in moved from Supabase phone OTP (0006, 0011) to Clerk email/OAuth.
-- The OTP functions are no longer called by any customer path, so they can be dropped.
-- The otp_requests table is kept for now — removing a table is a one-way door on
-- a live database, and the empty table does no harm.

-- Drop the OTP rate limit function that is no longer called anywhere.
drop function if exists ac_consume_otp_rate_limit(text, text);

-- Also clean up the legacy identifier-hash version (0011 renamed phone_hash to identifier_hash).
-- This may not exist if migrations were applied in full sequence, but the conditional drop is harmless.
drop function if exists ac_consume_otp_rate_limit_old(text, text);

-- Note: otp_requests table is deliberately kept. It has RLS enabled with no policies,
-- so only service_role can access it. The table can be manually dropped later if desired,
-- but this migration takes the conservative approach.-- AlongCo — 0016_no_auth_customers.sql
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
