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
