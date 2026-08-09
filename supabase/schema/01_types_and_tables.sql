-- =============================================================================
-- AlongCo — 01_types_and_tables.sql
--
-- Enums, all tables, constraints, triggers, and indexes in one place.
-- No auth.* references — applies cleanly to a plain Postgres test instance.
--
-- Conventions:
--   · UUID PKs generated with gen_random_uuid()
--   · timestamptz everywhere, never timestamp
--   · Money as integer paise (100 paise = ₹1) — no floats, ever
--   · Derived columns maintained by triggers, not GENERATED ALWAYS (which
--     rejects STABLE expressions like timestamptz arithmetic)
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "btree_gist";  -- required by bookings_no_overlap


-- =============================================================================
-- ENUMS
-- =============================================================================

create type booking_status as enum (
  'pending_payment',       -- slot held, payment not yet captured
  'confirmed',
  'completed',
  'cancelled_by_customer',
  'cancelled_by_admin',
  'ended_early',           -- companion ended the session early
  'no_show_customer',
  'no_show_companion',
  'expired'                -- hold lapsed before payment
);

create type payment_status as enum (
  'created', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded'
);

create type refund_status as enum (
  'created', 'pending', 'success', 'failed'
);

create type incident_type as enum (
  'conduct_violation', 'safety_concern', 'no_show', 'payment_dispute', 'other'
);

create type incident_status as enum (
  'open', 'investigating', 'resolved', 'escalated'
);

create type ticket_status as enum (
  'open', 'waiting_on_customer', 'resolved', 'closed'
);

create type payout_status as enum (
  'owed', 'paid'
);


-- =============================================================================
-- SETTINGS
-- All runtime configuration. Never hardcoded in application code.
-- =============================================================================

create table settings (
  key        text        primary key,
  value      jsonb       not null,
  is_public  boolean     not null default false,  -- anon-readable; see RLS file
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into settings (key, value, is_public) values
  ('booking_window_days',    '7',        true),
  ('buffer_minutes',         '15',       true),
  ('min_duration_minutes',   '60',       true),
  ('hold_minutes',           '10',       true),
  ('service_hours',          '{"start":"08:00","end":"22:00"}', true),
  ('timezone',               '"Asia/Kolkata"',                  true),
  -- Discount tiers: matched descending, first hit wins.
  -- 1h ₹499, 2h ₹898 (−10%), 3h ₹1,048 (−30%).
  ('duration_discounts',     '[{"min_minutes":180,"percent":30},
                               {"min_minutes":120,"percent":10},
                               {"min_minutes":60, "percent":0}]', true),
  -- Refund tiers: time before booking start.
  ('refund_tiers',           '[{"min_hours_before":48,"percent":100,"code":"48h_full"},
                               {"min_hours_before":24,"percent":50, "code":"24h_half"},
                               {"min_hours_before":0, "percent":0,  "code":"under_24h_none"}]', true),
  ('terms_version',          '"2026-08-01"', true),
  ('confirmation_sla_minutes','15',      false),
  ('max_active_holds',       '3',        false),
  ('grievance_contact',      '{"name":"Grievance Officer","email":"privacy@alongco.com"}', true);


-- =============================================================================
-- AREAS
-- =============================================================================

create table areas (
  id         uuid    primary key default gen_random_uuid(),
  name       text    not null unique,
  is_active  boolean not null default true,
  sort_order integer not null default 0
);

insert into areas (name, sort_order) values
  ('MG Road', 1), ('Indiranagar', 2), ('Cubbon Park', 3);


-- =============================================================================
-- COMPANIONS
-- =============================================================================

create table companions (
  id                uuid        primary key default gen_random_uuid(),
  slug              text        not null unique,
  display_name      text        not null,       -- pseudonym only; never the legal name
  bio               text,
  photo_path        text,                        -- key in companion-photos bucket
  hourly_rate_paise integer     not null check (hourly_rate_paise > 0),
  is_active         boolean     not null default false,
  is_accepting      boolean     not null default true,  -- soft pause without deactivating
  created_at        timestamptz not null default now()
);

-- Real identity. Separate table, locked down independently — a careless
-- `select *` on companions cannot leak it.
create table companion_identities (
  companion_id        uuid        primary key references companions (id) on delete cascade,
  legal_name          text        not null,
  phone               text        not null,
  id_document_path    text,                      -- companion-docs bucket, private
  vetted_at           timestamptz,
  vetted_by           uuid,
  vetting_notes       text,
  agreement_signed_at timestamptz                -- conduct agreement with the operator
);

-- Weekly availability windows (IST weekday + time range).
create table companion_availability (
  id           uuid     primary key default gen_random_uuid(),
  companion_id uuid     not null references companions (id) on delete cascade,
  weekday      smallint not null check (weekday between 0 and 6),  -- 0 = Sunday
  start_time   time     not null,
  end_time     time     not null,
  check (end_time > start_time)
);

-- Index covers the common lookup: which slots is this companion available on
-- a given weekday?
create index idx_companion_availability_companion_weekday
  on companion_availability (companion_id, weekday);

-- Date-range blackouts (holidays, blocked periods).
create table companion_blackouts (
  id           uuid        primary key default gen_random_uuid(),
  companion_id uuid        not null references companions (id) on delete cascade,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  reason       text,                             -- internal only, never shown to customers
  check (ends_at > starts_at)
);

-- Covers the availability window query: blackouts overlapping [p_from, p_to).
create index idx_companion_blackouts_companion_window
  on companion_blackouts (companion_id, starts_at, ends_at);

-- Which areas each companion serves.
create table companion_areas (
  companion_id uuid references companions (id) on delete cascade,
  area_id      uuid references areas (id)       on delete cascade,
  primary key (companion_id, area_id)
);

-- Reverse lookup: find all companions in a given area.
create index idx_companion_areas_area
  on companion_areas (area_id);


-- =============================================================================
-- CUSTOMERS
-- Minimum data only (DPDP compliance). Consent recorded, erasure supported.
-- =============================================================================

create table customers (
  id                    uuid        primary key default gen_random_uuid(),
  -- Clerk user id (text, not uuid — Clerk subjects are not UUIDs).
  auth_user_id          text        unique,
  email                 text,                    -- verified by Clerk; used for account adoption
  phone                 text,                    -- self-declared at checkout; WhatsApp contact
  full_name             text,
  consent_version       text,
  consent_at            timestamptz,
  is_blocked            boolean     not null default false,
  block_reason          text,
  created_at            timestamptz not null default now(),
  deletion_requested_at timestamptz             -- DPDP erasure request; drives the purge job
);

-- Case-insensitive unique email — two casings must not become two accounts.
create unique index idx_customers_email_lower on customers (lower(email));

-- auth_user_id lookup is the hot path on every authenticated request.
-- The UNIQUE constraint creates an index, but name it explicitly for clarity.
create unique index idx_customers_auth_user_id on customers (auth_user_id);


-- =============================================================================
-- BOOKINGS
-- =============================================================================

create table bookings (
  id                   uuid           primary key default gen_random_uuid(),
  reference            text           not null unique,  -- e.g. AC-7F3K2M; on ticket/QR
  customer_id          uuid           not null references customers (id),
  companion_id         uuid           not null references companions (id),
  area_id              uuid           not null references areas (id),

  starts_at            timestamptz    not null,
  ends_at              timestamptz    not null,
  buffer_minutes       integer        not null default 15,

  -- Derived: booking window + trailing buffer. Always maintained by the
  -- trigger below — any direct write is silently overridden.
  reserved_period      tstzrange      not null,

  status               booking_status not null default 'pending_payment',
  hold_expires_at      timestamptz,               -- only meaningful while pending_payment

  amount_paise         integer        not null check (amount_paise > 0),
  rate_snapshot_paise  integer        not null,    -- companion's rate at booking time
  discount_percent     smallint       not null default 0,

  -- Conduct policy is unenforceable without these. Both NOT NULL.
  terms_version        text           not null,
  terms_accepted_at    timestamptz    not null default now(),

  customer_notes       text,

  -- Manual WhatsApp confirmation dispatch (PRD §6.8).
  confirmation_sent_at timestamptz,
  confirmation_sent_by uuid,

  -- Cancellation provenance (PRD §6.9).
  cancelled_at         timestamptz,
  cancelled_by         text           check (cancelled_by in ('customer', 'admin', 'companion')),
  cancellation_reason  text,
  refund_tier_applied  text,

  completed_at         timestamptz,
  confirmed_at         timestamptz,
  created_at           timestamptz    not null default now(),

  check (ends_at > starts_at),
  -- Safety net; authoritative minimum is settings.min_duration_minutes.
  check (ends_at - starts_at >= interval '60 minutes')
);

-- Trigger: always recompute reserved_period. Fires on every INSERT and UPDATE,
-- so a caller that tries to set it directly is silently corrected.
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

create trigger trg_bookings_sync_reserved_period
  before insert or update on bookings
  for each row execute function ac_sync_reserved_period();

-- THE critical constraint: no two live bookings may overlap for the same
-- companion, buffer included. Enforced in the database, not the UI.
-- Statuses not in this list free the slot (cancelled_*, expired).
alter table bookings add constraint bookings_no_overlap
  exclude using gist (
    companion_id  with =,
    reserved_period with &&
  )
  where (status in (
    'pending_payment', 'confirmed', 'completed',
    'ended_early', 'no_show_customer', 'no_show_companion'
  ));

-- ── Booking indexes ──────────────────────────────────────────────────────────

-- Customer's own bookings, newest first (my-bookings page).
create index idx_bookings_customer_starts
  on bookings (customer_id, starts_at desc);

-- Companion schedule (availability computation).
create index idx_bookings_companion_starts
  on bookings (companion_id, starts_at);

-- Cron: find holds to expire — partial, so only pending_payment rows are scanned.
create index idx_bookings_pending_hold_expiry
  on bookings (hold_expires_at)
  where status = 'pending_payment';

-- Hold-cap check in create_booking_hold: count live holds per customer.
-- Covers: WHERE customer_id = ? AND status = 'pending_payment' AND hold_expires_at > now()
create index idx_bookings_pending_customer
  on bookings (customer_id, hold_expires_at)
  where status = 'pending_payment';

-- Cron: find confirmed bookings to complete.
create index idx_bookings_confirmed_ends
  on bookings (ends_at)
  where status = 'confirmed';

-- Admin confirmation queue: unsent messages past SLA.
create index idx_bookings_confirmed_unsent
  on bookings (confirmed_at)
  where status = 'confirmed' and confirmation_sent_at is null;

-- Admin bookings list: filter by status + date range.
create index idx_bookings_status_starts
  on bookings (status, starts_at desc);


-- =============================================================================
-- BOOKING EVENTS (audit trail)
-- =============================================================================

create table booking_events (
  id          uuid           primary key default gen_random_uuid(),
  booking_id  uuid           not null references bookings (id) on delete cascade,
  from_status booking_status,
  to_status   booking_status not null,
  actor_type  text           not null check (actor_type in ('customer', 'companion', 'admin', 'system')),
  actor_id    uuid,
  reason      text,
  created_at  timestamptz    not null default now()
);

create index idx_booking_events_booking_created
  on booking_events (booking_id, created_at desc);


-- =============================================================================
-- PAYMENTS
-- provider_* columns carry the gateway's identifiers without naming the vendor.
-- payment_provider records which gateway actually processed each payment so
-- refunds always go back through the correct system.
-- =============================================================================

create table payments (
  id                  uuid           primary key default gen_random_uuid(),
  booking_id          uuid           not null references bookings (id),
  payment_provider    text           not null default 'razorpay'
                                     check (payment_provider in ('razorpay', 'cashfree')),
  -- Gateway's order handle. Multiple attempts per booking are allowed (retry flow).
  provider_order_id   text           not null,
  provider_payment_id text,                        -- populated after authorization
  provider_session_id text,                        -- checkout session token, if any
  amount_paise        integer        not null check (amount_paise > 0),
  status              payment_status not null default 'created',
  method              text,                        -- 'upi' | 'card' | … never the instrument
  failure_reason      text,
  created_at          timestamptz    not null default now(),
  captured_at         timestamptz
);

-- Uniqueness is per-provider (order ids are only unique within a gateway).
create unique index idx_payments_provider_order
  on payments (payment_provider, provider_order_id);

create unique index idx_payments_provider_payment
  on payments (payment_provider, provider_payment_id)
  where provider_payment_id is not null;

-- Booking payment history, newest first.
create index idx_payments_booking_created
  on payments (booking_id, created_at desc);

-- Finance reconciliation: captured payments within a date range.
create index idx_payments_captured_status
  on payments (captured_at, status)
  where status in ('captured', 'refunded', 'partially_refunded');


-- =============================================================================
-- REFUNDS
-- =============================================================================

create table refunds (
  id                uuid         primary key default gen_random_uuid(),
  payment_id        uuid         not null references payments (id),
  booking_id        uuid         not null references bookings (id),
  provider_refund_id text        unique,          -- gateway's refund id
  refund_reference  text         not null unique, -- our idempotency key sent to the gateway
  amount_paise      integer      not null check (amount_paise > 0),
  status            refund_status not null default 'created',
  tier_applied      text,                          -- settings code e.g. '48h_full'
  initiated_by      uuid,
  notes             text,
  proof_url         text,                          -- screenshot URL for manual refund confirmation
  created_at        timestamptz  not null default now(),
  settled_at        timestamptz
);

create index idx_refunds_booking    on refunds (booking_id);
create index idx_refunds_payment    on refunds (payment_id);
-- Finance reconciliation: refunds settled within a date range.
create index idx_refunds_created    on refunds (created_at desc);


-- =============================================================================
-- WEBHOOK EVENTS (idempotency store)
-- Gateways retry webhooks; recording the event_id and ignoring repeats is the
-- only safe way to handle them.
-- =============================================================================

create table webhook_events (
  id            uuid        primary key default gen_random_uuid(),
  provider      text        not null default 'razorpay',
  event_id      text        not null,
  event_type    text        not null,
  payload       jsonb       not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  process_error text,
  unique (provider, event_id)
);


-- =============================================================================
-- PAYOUTS
-- Manual companion payouts. Automated payouts are a v2 non-goal.
-- =============================================================================

create table payouts (
  id            uuid          primary key default gen_random_uuid(),
  companion_id  uuid          not null references companions (id),
  period_start  date          not null,
  period_end    date          not null,
  amount_paise  integer       not null check (amount_paise > 0),
  status        payout_status not null default 'owed',
  utr_reference text,                              -- bank UTR, recorded when paid
  paid_at       timestamptz,
  paid_by       uuid,
  notes         text,
  created_at    timestamptz   not null default now(),
  check (period_end >= period_start)
);

create index idx_payouts_companion_period
  on payouts (companion_id, period_start);


-- =============================================================================
-- REVIEWS
-- One per completed booking. "Verified" means tied to a real booking, nothing
-- more. Publication requires admin moderation.
-- =============================================================================

create table reviews (
  id              uuid        primary key default gen_random_uuid(),
  booking_id      uuid        not null unique references bookings (id),
  customer_id     uuid        not null references customers (id),
  companion_id    uuid        not null references companions (id),
  rating          smallint    not null check (rating between 1 and 5),
  body            text,
  is_published    boolean     not null default false,
  moderated_at    timestamptz,
  moderated_by    uuid,
  moderation_note text,
  created_at      timestamptz not null default now()
);

-- Public-facing companion profile only needs published reviews.
create index idx_reviews_companion_published
  on reviews (companion_id, created_at desc)
  where is_published;

-- Admin moderation queue.
create index idx_reviews_unmoderated
  on reviews (created_at)
  where moderated_at is null;


-- =============================================================================
-- INCIDENTS
-- =============================================================================

create table incidents (
  id           uuid            primary key default gen_random_uuid(),
  booking_id   uuid            references bookings (id),
  companion_id uuid            references companions (id),
  customer_id  uuid            references customers (id),
  type         incident_type   not null,
  status       incident_status not null default 'open',
  reported_by  text            not null check (reported_by in ('customer', 'companion', 'admin')),
  description  text            not null,
  action_taken text,
  ended_booking  boolean       not null default false,
  refund_issued  boolean       not null default false,
  created_at   timestamptz     not null default now(),
  created_by   uuid,
  resolved_at  timestamptz,
  resolved_by  uuid
);

create index idx_incidents_booking    on incidents (booking_id);
create index idx_incidents_status     on incidents (status, created_at desc);
create index idx_incidents_companion  on incidents (companion_id, created_at desc);


-- =============================================================================
-- SUPPORT TICKETS
-- =============================================================================

create table support_tickets (
  id          uuid          primary key default gen_random_uuid(),
  customer_id uuid          references customers (id),
  booking_id  uuid          references bookings (id),
  subject     text          not null,
  status      ticket_status not null default 'open',
  assigned_to uuid,
  created_at  timestamptz   not null default now()
);

create index idx_support_tickets_customer  on support_tickets (customer_id);
create index idx_support_tickets_status    on support_tickets (status, created_at desc);

create table support_messages (
  id         uuid        primary key default gen_random_uuid(),
  ticket_id  uuid        not null references support_tickets (id) on delete cascade,
  author     text        not null check (author in ('customer', 'admin')),
  body       text        not null,
  created_at timestamptz not null default now()
);

create index idx_support_messages_ticket on support_messages (ticket_id, created_at);


-- =============================================================================
-- ADMIN
-- =============================================================================

create table admin_users (
  id         uuid        primary key,              -- Supabase auth.users.id
  email      text        not null unique,
  role       text        not null check (role in ('owner', 'ops', 'support')),
  is_active  boolean     not null default true,
  created_at timestamptz not null default now()
);

create table admin_audit_log (
  id          uuid        primary key default gen_random_uuid(),
  admin_id    uuid        not null references admin_users (id),
  action      text        not null,                -- 'refund.issue', 'companion.deactivate', …
  entity_type text        not null,
  entity_id   uuid,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index idx_admin_audit_log_created on admin_audit_log (created_at desc);
create index idx_admin_audit_log_admin   on admin_audit_log (admin_id, created_at desc);

-- Rate-limiting table for admin login attempts (email + password).
-- Hashed identifiers only — never the address or IP itself.
create table admin_login_attempts (
  id           uuid        primary key default gen_random_uuid(),
  email_hash   text        not null,
  ip_hash      text        not null,
  succeeded    boolean     not null default false,
  attempted_at timestamptz not null default now()
);

create index idx_admin_login_email on admin_login_attempts (email_hash, attempted_at desc);
create index idx_admin_login_ip    on admin_login_attempts (ip_hash,    attempted_at desc);

-- OTP request log. Kept for audit; actual function dropped in later migration.
-- All columns carry hashes, never raw phone numbers or email addresses.
create table otp_requests (
  id              uuid        primary key default gen_random_uuid(),
  identifier_hash text        not null,
  ip_hash         text        not null,
  requested_at    timestamptz not null default now()
);

create index idx_otp_requests_identifier on otp_requests (identifier_hash, requested_at desc);
create index idx_otp_requests_ip         on otp_requests (ip_hash,         requested_at desc);
