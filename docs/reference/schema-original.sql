-- AlongCo — Supabase / Postgres schema (MVP)
-- Conventions: UUID PKs, timestamptz everywhere, money in paise (integer).
-- RLS is assumed ON for every table; policies sketched at the bottom.

create extension if not exists "pgcrypto";
create extension if not exists "btree_gist";   -- required for the no-overlap constraint

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
create type incident_type   as enum ('conduct_violation','safety_concern','no_show','payment_dispute','other');
create type incident_status as enum ('open','investigating','resolved','escalated');
create type ticket_status   as enum ('open','waiting_on_customer','resolved','closed');

-- ---------------------------------------------------------------------------
-- Config
-- ---------------------------------------------------------------------------

create table settings (
  key          text primary key,
  value        jsonb not null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);

-- Seed the values the app reads at runtime; change these, not the code.
insert into settings (key, value) values
  ('booking_window_days',  '7'),
  ('buffer_minutes',       '15'),
  ('min_duration_minutes', '60'),
  ('hold_minutes',         '10'),
  ('service_hours',        '{"start":"08:00","end":"22:00"}'),
  ('refund_tiers',         '[{"min_hours_before":48,"percent":100},
                             {"min_hours_before":24,"percent":50},
                             {"min_hours_before":0,"percent":0}]');

create table areas (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,        -- 'MG Road', 'Indiranagar', 'Cubbon Park'
  is_active  boolean not null default true,
  sort_order integer not null default 0
);

-- ---------------------------------------------------------------------------
-- Companions
-- ---------------------------------------------------------------------------

create table companions (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,          -- public URL
  display_name      text not null,                 -- PSEUDONYM — the only name ever sent to a client
  bio               text,
  photo_path        text,                          -- Supabase Storage key
  hourly_rate_paise integer not null check (hourly_rate_paise > 0),
  is_active         boolean not null default false,
  is_accepting      boolean not null default true, -- soft pause without deactivating
  created_at        timestamptz not null default now()
);

-- Real identity. Separate table so it can be locked down independently and is
-- impossible to leak by a careless `select *` on companions.
create table companion_identities (
  companion_id     uuid primary key references companions(id) on delete cascade,
  legal_name       text not null,
  phone            text not null,
  id_document_path text,                    -- Storage, private bucket
  vetted_at        timestamptz,
  vetted_by        uuid,
  vetting_notes    text,
  agreement_signed_at timestamptz           -- conduct agreement with the operator
);

-- Recurring weekly availability, set by admin.
create table companion_availability (
  id           uuid primary key default gen_random_uuid(),
  companion_id uuid not null references companions(id) on delete cascade,
  weekday      smallint not null check (weekday between 0 and 6),  -- 0 = Sunday
  start_time   time not null,
  end_time     time not null,
  check (end_time > start_time)
);

-- One-off unavailability (leave, already-committed time).
create table companion_blackouts (
  id           uuid primary key default gen_random_uuid(),
  companion_id uuid not null references companions(id) on delete cascade,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  reason       text,
  check (ends_at > starts_at)
);

create table companion_areas (
  companion_id uuid references companions(id) on delete cascade,
  area_id      uuid references areas(id) on delete cascade,
  primary key (companion_id, area_id)
);

-- ---------------------------------------------------------------------------
-- Customers  (DPDP: collect the minimum, record consent, support deletion)
-- ---------------------------------------------------------------------------

create table customers (
  id                 uuid primary key default gen_random_uuid(),
  auth_user_id       uuid unique,            -- Supabase auth.users.id (phone OTP)
  phone              text not null unique,
  full_name          text,                   -- collected at first booking
  consent_version    text,                   -- which notice they accepted
  consent_at         timestamptz,
  is_blocked         boolean not null default false,
  block_reason       text,
  created_at         timestamptz not null default now(),
  deletion_requested_at timestamptz          -- DPDP erasure request; drives purge job
);

-- ---------------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------------

create table bookings (
  id                 uuid primary key default gen_random_uuid(),
  reference          text not null unique,    -- human-facing, e.g. AC-7F3K2M — goes on the ticket/QR
  customer_id        uuid not null references customers(id),
  companion_id       uuid not null references companions(id),
  area_id            uuid not null references areas(id),

  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  buffer_minutes     integer not null default 15,

  -- Reserved window = booking + trailing buffer. Generated, so it can never
  -- drift out of sync with starts_at/ends_at.
  reserved_period    tstzrange generated always as (
                       tstzrange(starts_at, ends_at + make_interval(mins => buffer_minutes), '[)')
                     ) stored,

  status             booking_status not null default 'pending_payment',
  hold_expires_at    timestamptz,             -- set on creation; cron expires stale holds

  amount_paise       integer not null check (amount_paise > 0),
  rate_snapshot_paise integer not null,       -- rate at time of booking; rates change

  -- Terms accepted at checkout. Without this the conduct policy is unenforceable.
  terms_version      text not null,
  terms_accepted_at  timestamptz not null default now(),

  customer_notes     text,
  created_at         timestamptz not null default now(),

  check (ends_at > starts_at),
  check (ends_at - starts_at >= interval '60 minutes')
);

-- THE important constraint. Two confirmed/pending bookings can never overlap
-- for the same companion, buffer included — enforced in the database, not the UI.
alter table bookings add constraint bookings_no_overlap
  exclude using gist (
    companion_id with =,
    reserved_period with &&
  ) where (status in ('pending_payment','confirmed','completed','ended_early','no_show_customer'));

create index on bookings (customer_id, starts_at desc);
create index on bookings (companion_id, starts_at);
create index on bookings (status, hold_expires_at) where status = 'pending_payment';

-- Every status change, who made it and why. This is your audit trail when a
-- customer disputes something months later.
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

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------

create table payments (
  id                   uuid primary key default gen_random_uuid(),
  booking_id           uuid not null references bookings(id),
  razorpay_order_id    text not null unique,
  razorpay_payment_id  text unique,
  amount_paise         integer not null,
  status               payment_status not null default 'created',
  method               text,
  failure_reason       text,
  created_at           timestamptz not null default now(),
  captured_at          timestamptz
);

create table refunds (
  id                 uuid primary key default gen_random_uuid(),
  payment_id         uuid not null references payments(id),
  booking_id         uuid not null references bookings(id),
  razorpay_refund_id text unique,
  amount_paise       integer not null check (amount_paise > 0),
  tier_applied       text,          -- e.g. '48h_full', 'companion_cancelled', 'conduct_no_refund'
  initiated_by       uuid,
  notes              text,
  created_at         timestamptz not null default now()
);

-- Razorpay webhooks arrive more than once. Store the event id and ignore repeats.
create table webhook_events (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null default 'razorpay',
  event_id     text not null,
  event_type   text not null,
  payload      jsonb not null,
  processed_at timestamptz,
  unique (provider, event_id)
);

-- ---------------------------------------------------------------------------
-- Reviews  (one per completed booking — this is what "verified" means)
-- ---------------------------------------------------------------------------

create table reviews (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null unique references bookings(id),
  customer_id  uuid not null references customers(id),
  companion_id uuid not null references companions(id),
  rating       smallint not null check (rating between 1 and 5),
  body         text,
  is_published boolean not null default false,   -- admin moderation
  created_at   timestamptz not null default now()
);

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
  ended_booking  boolean not null default false,   -- was the booking terminated over this
  refund_issued  boolean not null default false,
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  resolved_by    uuid
);

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
  id           uuid primary key,              -- Supabase auth.users.id
  email        text not null unique,
  role         text not null check (role in ('owner','ops','support')),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table admin_audit_log (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid not null references admin_users(id),
  action      text not null,                  -- 'refund.issue', 'companion.deactivate', ...
  entity_type text not null,
  entity_id   uuid,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS sketch  (enable on every table; deny by default)
-- ---------------------------------------------------------------------------
--
--  companions            : anon can select where is_active — and only the public
--                          columns. Do NOT expose companion_identities via any view.
--  companion_identities  : service_role only. No client policy at all.
--  customers             : select/update own row where auth_user_id = auth.uid()
--  bookings              : select own rows. INSERT goes through a security-definer
--                          RPC so the server sets price, hold expiry and status —
--                          never trust an amount sent from the browser.
--  payments / refunds    : service_role only; clients read status via the booking.
--  reviews               : insert allowed only when the referenced booking belongs
--                          to the caller AND status = 'completed' AND ends_at < now().
--                          Public select limited to is_published = true.
--  incidents, audit log  : service_role / admin only.
--
-- Two background jobs to schedule (pg_cron):
--   1. every minute  — expire holds: pending_payment where hold_expires_at < now()
--   2. hourly        — mark confirmed bookings past ends_at as 'completed'
