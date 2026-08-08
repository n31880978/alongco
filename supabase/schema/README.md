# supabase/schema/

Consolidated, rewritten SQL — the entire database in eight well-scoped files.

## Why this exists alongside `migrations/`

`migrations/` is the **deploy history** — every numbered file represents a
change that was applied to the hosted database. Those files stay as-is for
rollback and audit purposes.

This folder is the **current authoritative schema**: the schema you would
apply to a brand-new database to get the exact same result as running all 15
migrations in sequence. It is also the reference you read when you want to
understand the database without chasing `alter table` statements across 15
files.

## Files

| File | Contents |
|------|----------|
| `01_types_and_tables.sql` | Enums, all tables, constraints, triggers, indexes |
| `02_functions.sql` | Pure helpers: settings, pricing, availability, cron workers |
| `03_rls.sql` | Row Level Security, `ac_auth_subject()`, `ac_ensure_customer()`, `create_booking_hold()` |
| `04_booking_actions.sql` | Booking details, customer cancellation, admin cancellation, rate limiter |
| `05_admin_auth.sql` | Admin login attempt throttle |
| `06_storage.sql` | Storage buckets and access policies |
| `07_grants.sql` | All `REVOKE`/`GRANT EXECUTE` in one place |
| `08_cron.sql` | pg_cron schedules |

## What changed vs the migrations

**New indexes added:**

| Table | Column(s) | Reason |
|-------|-----------|--------|
| `companion_areas` | `area_id` | Find all companions in an area without a full scan |
| `companion_blackouts` | `(companion_id, starts_at, ends_at)` | Availability window query |
| `customers` | `auth_user_id` (named) | Hot path on every authenticated request |
| `customers` | `lower(email)` (named) | Account adoption on sign-in |
| `bookings` | `(status, starts_at desc)` | Admin booking list with status filter |
| `bookings` | `confirmed_at` where unsent | Renamed/tightened confirmation queue index |
| `payments` | `(captured_at, status)` partial | Finance reconciliation date-range query |
| `refunds` | `payment_id`, `created_at desc` | Reconciliation and per-payment lookup |
| `reviews` | `(companion_id, created_at desc)` partial | Profile page sorted published reviews |
| `reviews` | `created_at` where unmoderated | Admin moderation queue |
| `incidents` | `(companion_id, created_at desc)` | Admin companion incident history |
| `support_tickets` | `(customer_id)`, `(status, created_at)` | Support queue |
| `admin_audit_log` | `(admin_id, created_at desc)` | Per-admin audit trail |

**Naming improvements:**

All indexes are named explicitly (`idx_<table>_<purpose>`) rather than using
Postgres's auto-generated names. This makes `\d bookings` readable and makes
migrations that drop/recreate indexes deterministic.

**Consolidation:**

Functions that were rewritten across multiple migrations (`ac_ensure_customer`,
`create_booking_hold`, `ac_set_booking_details`, `ac_admin_cancel_booking`,
`ac_cancel_own_booking`, `ac_quote_own_cancellation`) appear here in their
final form only.

OTP rate-limit function (`ac_consume_otp_rate_limit`) is omitted — it was
dropped in migration 0015 when auth moved to Clerk.
