# AlongCo — Full Application Audit Report
**Date:** 2026-08-09  
**Build state:** 139 tests passing (55 unit, 84 DB integration) · typecheck clean · production build clean  
**Auditor:** Kiro  

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Tech Stack](#2-tech-stack)
3. [Architecture Summary](#3-architecture-summary)
4. [Database Layer](#4-database-layer)
5. [Authentication & Authorization](#5-authentication--authorization)
6. [Payment Flow](#6-payment-flow)
7. [Security Assessment](#7-security-assessment)
8. [Code Quality](#8-code-quality)
9. [Test Coverage](#9-test-coverage)
10. [Build & Deployment](#10-build--deployment)
11. [Outstanding Work & Blockers](#11-outstanding-work--blockers)
12. [Findings Summary](#12-findings-summary)
13. [Recommendations](#13-recommendations)

---

## 1. Product Overview

AlongCo is a companion booking platform for women in Bangalore. Customers book a vetted companion (pseudonym and photo only — no real identity ever exposed) for one or more hours of non-romantic company in a public place. The three served areas are MG Road, Indiranagar, and Cubbon Park.

The product is mobile-first web only (no native app). Coordination between customer and companion happens over WhatsApp, dispatched manually by an admin in v1. There is no chat feature, no self-service companion portal, and no automated payout — all intentional scope decisions.

---

## 2. Tech Stack

| Layer | Choice | Version |
|---|---|---|
| Framework | Next.js App Router + React Server Components | next ^16.3.0, react ^19.0.0 |
| Language | TypeScript | ^5.7.3 |
| Styling | Tailwind CSS + shadcn/ui + Radix UI | tailwind ^3.4.17 |
| Database | Supabase Postgres (RLS on every table) | @supabase/supabase-js ^2.112.1 |
| Auth — customers | Clerk (email OTP via MSG91/Supabase hook) | @clerk/nextjs ^7.7.0 |
| Auth — admins | Supabase email + password (completely separate) | @supabase/ssr ^0.12.4 |
| Payments | Razorpay Standard Checkout (integer paise) | direct fetch, no SDK |
| Storage | Supabase Storage — companion-photos (public), companion-docs (private) | — |
| Cron | pg_cron inside Postgres (not Vercel Cron) | — |
| Analytics | Google Analytics (6 funnel events, no PII) | @vercel/analytics ^2.0.1 |
| Error monitoring | Custom observability seam (Sentry-ready, not yet wired) | — |
| Testing | Vitest against real Postgres | vitest ^3.0.4 |
| Hosting | Vercel (DNS/project setup pending) | — |
| Validation | Zod at every server action boundary | ^3.24.1 |

---

## 3. Architecture Summary

### Route groups
```
app/
  (public)/     — alongco.com, Clerk session, customer-facing
  (admin)/      — admin.alongco.com, Supabase session, operator-facing
  api/
    webhooks/razorpay/   — idempotent payment events, HMAC-verified
    cron/expire-holds/   — manual trigger for pg_cron job
    cron/complete-bookings/
```

### Middleware (proxy.ts)
The middleware lives in `proxy.ts` (not `middleware.ts`). It performs host-based routing:
- `ADMIN_HOST` rewrites bare paths into `/admin/*` and refreshes the Supabase cookie
- public host with `/admin/*` paths → hard 404 (refuses to acknowledge route existence)
- Clerk middleware is lazy-initialised and only invoked for public-host requests

### Patterns
- Server Components by default; `'use client'` only for interactive leaves
- All mutations are **server actions**, not route handlers (exceptions: webhooks, cron)
- Every server action input is validated with Zod at the boundary
- Domain logic in `lib/` exclusively — nothing in components
- Times are `timestamptz` in DB, rendered in IST (Asia/Kolkata)

---

## 4. Database Layer

### Schema design
16 tables across 15 migrations (`0001_init` → `0015_cleanup_otp_functions`).

**Key design decisions enforced correctly:**
- Money is integer paise throughout — no floats anywhere in the payment path
- `reserved_period tstzrange` on bookings is maintained by a `BEFORE INSERT OR UPDATE` trigger (`ac_sync_reserved_period`), so a caller cannot set it directly
- Booking overlap prevention is a **GiST exclusion constraint** (`bookings_no_overlap`), not a UI check or a read-then-write guard — this is correct and critical
- `companion_identities` is a separate table, locked down independently — a careless `SELECT *` on `companions` cannot leak real names
- All configuration (booking window, buffer, hold TTL, discount tiers, refund tiers, service hours) lives in the `settings` table — nothing is hardcoded
- `booking_events` is an append-only audit trail for every status change
- `webhook_events` is the idempotency store with a unique `(provider, event_id)` index

### RLS
- RLS enabled on **every** table, deny by default
- `FORCE ROW LEVEL SECURITY` applied to `companion_identities`, `payments`, `refunds`, `admin_audit_log` — even the table owner cannot bypass
- Public surfaces: active companions, public settings, active areas, published reviews
- Customer access: own bookings/events/reviews via `ac_auth_subject()` (reads Clerk JWT `sub` as text, not `auth.uid()` — correct, since Clerk subjects are not UUIDs)
- All state-changing operations go through security-definer RPCs, not client inserts

### Key database functions
| Function | Purpose |
|---|---|
| `create_booking_hold()` | All booking creation — price computation, overlap check, hold limit, terms check |
| `ac_set_booking_status()` | All status transitions + booking_events audit row, idempotent |
| `ac_quote()` | Pricing: rounds to rupee |
| `ac_refund_quote()` | Refunds: does NOT round (intentional — 50% of ₹499 = ₹249.50) |
| `ac_ensure_customer()` | Customer bootstrap + email adoption (service_role only) |
| `ac_expire_holds()` | pg_cron: pending_payment past hold_expires_at → expired, SKIP LOCKED |
| `ac_complete_bookings()` | pg_cron: confirmed past ends_at → completed, SKIP LOCKED |
| `ac_check_action_rate_limit()` | Rate limits booking holds and reviews per customer |
| `ac_admin_cancel_booking()` | Cancel + refund in one transaction, atomic |
| `get_availability_inputs()` | Security definer, strips blackout reasons before returning |

### Indexing
All hot paths are covered: customer bookings by `starts_at`, companion schedule, pending holds by `hold_expires_at` (partial), confirmation queue (partial), published reviews (partial), status + date range. No obvious missing indexes for the current data model.

---

## 5. Authentication & Authorization

### Customer auth (Clerk)
- Email OTP delivered via MSG91 through a Supabase Send-SMS auth hook (`supabase/functions/send-sms-otp`)
- `lib/auth/session.ts`: `getAuthSubject()` reads Clerk JWT, `requireCustomer()` lazily upserts the customer row via `ac_ensure_customer` RPC
- Email is always taken from Clerk's verified record, never from anything the browser sent
- Account adoption on re-sign-in (same email, different Clerk subject) is handled server-side in the RPC

### Admin auth (Supabase email+password)
- Completely separate from Clerk — a valid customer session is not accepted on the admin surface
- `requireAdmin()`: no session → redirect to admin sign-in; valid Supabase session but not in `admin_users` → `notFound()` (refuses to acknowledge route existence)
- Three roles with rank: `support < ops < owner`
- `owner` is the only role that may access `companion_identities`
- Every state-changing admin action writes to `admin_audit_log` via `writeAudit()`
- Admin login is rate-limited via `admin_login_attempts` (hashed email + IP, never raw)

### Host routing security
- Requests to the public host with `/admin/*` paths return HTTP 404 — no redirect, no login prompt
- The admin surface uses only Supabase cookies; Clerk is never invoked on the admin host

---

## 6. Payment Flow

### Order creation
1. Customer selects slot and duration → server action calls `create_booking_hold()` RPC
2. RPC computes price from `companion.hourly_rate_paise` × duration × discount tier (all from DB, never from client)
3. RPC writes `bookings` row with `status = 'pending_payment'` and `hold_expires_at = now() + 10 minutes`
4. Server action creates a Razorpay order, stores in `payments`, returns `order_id` to client
5. Client opens Razorpay checkout — price is read from the DB order, not from client state

### Payment confirmation
1. Razorpay fires `payment.captured` webhook to `/api/webhooks/razorpay`
2. Handler verifies HMAC on **raw body** (not re-serialised — correct)
3. Idempotency gate: inserts into `webhook_events`; unique violation on `(provider, event_id)` → 200 duplicate, stops retry loop
4. Amount check: `payment.amount` from webhook must exactly equal `payments.amount_paise` — mismatch throws
5. RPC `ac_set_booking_status(p_to: 'confirmed')` — this is the **only** path that sets a booking confirmed
6. Post-expiry race handled: if the slot was resold (exclusion constraint fires 23P01), the webhook acknowledges (not 500), writes a `booking_events` row, and reports critical — operator refunds manually

### Refunds
- Refund tiers come from `settings.refund_tiers`, computed by `ac_refund_quote()`
- Refunds use a `refund_reference` as an idempotency key sent to the gateway
- Admin cancels via `ac_admin_cancel_booking()` — DB transaction owns the arithmetic and state change atomically
- Refund amounts are exact paise, not rounded (unlike pricing which rounds to the whole rupee)
- Payment provider is recorded per payment so refunds always route back through the correct gateway

---

## 7. Security Assessment

### Strengths

| Item | Status |
|---|---|
| Price always computed server-side | ✅ Enforced in DB RPC, client has no price field |
| HMAC verification on raw body | ✅ Correct — no re-serialisation |
| Timing-safe comparisons | ✅ Both HMAC and CRON_SECRET |
| Integer paise throughout | ✅ No floats in payment path |
| `server-only` import guard on service client | ✅ Build error if imported in client component |
| RLS deny-by-default on every table | ✅ Confirmed by 23 RLS tests |
| `force row level security` on sensitive tables | ✅ payments, refunds, identities, audit log |
| No price/status from client | ✅ All state changes via security-definer RPCs |
| Admin route 404s for customers | ✅ `notFound()` not redirect |
| Webhook idempotency | ✅ Unique (provider, event_id) index |
| Hashed identifiers in rate-limit tables | ✅ Never raw phone/IP stored |
| Admin audit log on every mutation | ✅ `writeAudit()` in every server action |
| `companion_identities` isolated | ✅ Separate table, no client policy |
| No PII in logs | ✅ Redactor in `lib/observability/report.ts` |
| Booking overlap in DB constraint | ✅ GiST exclusion, not UI check |
| Post-expiry payment race handled | ✅ Fixed in T24 drill |

### Issues

**🔴 High**

1. **`proxy.ts` is the actual middleware but not named `middleware.ts`**  
   Next.js picks up the file because it exports `config` with a matcher, but this is non-standard. A developer cloning the repo and not reading the notes will not find the auth layer. The routing, session refresh, and admin 404 all live here — losing this file silently removes all authentication. **Rename to `middleware.ts`.**

2. **`lib/admin/queries.ts` — errors silently swallowed on all reads**  
   Every query uses `const { data } = await service.from(...)...` without checking the `error` field. An RLS misconfiguration, connection exhaustion, or DB error returns `null`/empty, which surfaces as an empty admin list. An operator sees "no bookings" instead of an error, which is dangerous in an operations context. **Add error checking and surface DB errors to the admin UI.**

**🟡 Medium**

3. **`netlify.toml` present with Vercel as the stated host**  
   An accidental Netlify deployment would run with different environment variable resolution and no `ADMIN_HOST` routing. Remove the file.

4. **`any` casts throughout `lib/admin/queries.ts`**  
   Every query result is cast `as any[]` before mapping. Supabase generates a `Database` type from the schema; these queries should use it. A column rename or type change will fail at runtime, not at the TypeScript build step. Not a security issue but a correctness risk.

5. **Admin list views have a hard `.limit(200)` with no pagination**  
   `listAdminBookings`, `listAdminReviews`, `listAdminIncidents`, `listAdminCustomers` all silently truncate at 200 rows. This is fine at launch but will become a data-integrity issue as volume grows. Add cursor or offset pagination before the 200 row limit becomes reachable in production.

6. **`ac_generate_reference()` uses `random()`**  
   Postgres `random()` is not cryptographically secure. The reference appears on tickets and QR codes. Since it is not a secret (it is shared with the customer) this is not a security vulnerability, but a collision between two simultaneously created bookings is possible even with the retry loop. Consider `gen_random_bytes()` for the random component.

7. **`get_availability_inputs()` RPC has no rate limit**  
   It is readable by any authenticated user for any `companion_id`. The data it returns (busy windows) reveals booking patterns without customer details, so the privacy impact is low. However, it could be used to enumerate booking volume. Consider adding a rate limit consistent with the other action limits.

**🟢 Low / Style**

8. **`vercel.json` is essentially empty**  
   No region pinning, no environment variable aliases, no redirect rules. The `docs/deployment/vercel.md` file covers the setup steps but the config file itself offers no guardrails.

9. **`scripts/create-admin.mjs` lacks documentation in CLAUDE.md**  
   The script writes directly to `admin_users`. It should be listed in CLAUDE.md §7 (Environment) with a note that it requires `DATABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` and must never be run against production without an `owner` role being set explicitly.

10. **CSP uses `unsafe-inline` for `script-src`**  
    Required by Next.js inline scripts (the comment acknowledges this). The proper fix is nonce-based CSP via a custom `Document`, which is out of scope for a first pass but should be tracked as a hardening task.

---

## 8. Code Quality

### What is done well
- Hard invariants from CLAUDE.md §3 are consistently enforced at the database layer
- Domain logic is isolated in `lib/` — nothing domain-specific in components
- The observability seam is centralised with an allowlist and redactor
- `report()` is called on every failure that could lose money
- `SKIP LOCKED` in cron functions prevents concurrent job contention
- Refund arithmetic is explicitly separated from pricing arithmetic (different rounding rules, documented in comments)
- Cancellation provenance and refund tiers are both written to the booking row — audit trail is complete
- `terms_version` + `terms_accepted_at` are NOT NULL on every booking — PRD §6.5 enforced

### What needs attention

**`lib/admin/queries.ts`** — The file is 380+ lines of Supabase queries with:
- `as any[]` casts on every result (15+ instances)
- No error checking on any query
- Correct business logic but fragile against schema changes

This is the highest-priority code quality fix. The generated `Database` types from `supabase gen types typescript` would make all 15 queries fully type-safe.

**`lib/observability/report.ts`** — Good abstraction, but Sentry is described as "a DSN and one forward call" away. That forward call should be made before launch — a critical webhook failure (T24 scenario: money captured, booking not confirmed) currently only writes to a log. With Sentry, it pages someone.

---

## 9. Test Coverage

**139 tests total** — 55 unit, 84 DB integration.

### Unit tests (`tests/unit/`)
| File | Tests | Coverage |
|---|---|---|
| `availability.test.ts` | 24 | Service hours, booking window, past slots, blackouts, buffer, fully-booked day, day rollover |
| `pricing.test.ts` | ~10 | Discount tiers, integer arithmetic, overflow guard |
| `razorpay-verify.test.ts` | ~8 | HMAC signature verification, tampered body, wrong secret |
| `razorpay-client.test.ts` | ~5 | Razorpay client |
| `proxy.test.ts` | 5+ | Admin host routing, public host 404, path rewriting, Clerk isolation |
| `seo.test.ts` | — | SEO helpers |
| `button.test.tsx` | 1 | Component smoke test |

### DB integration tests (`tests/db/`)
| File | Tests | Coverage |
|---|---|---|
| `rls.test.ts` | 23 | Anon cannot read identities, payments, refunds, other customers' bookings; no self-unblock; no self-publish reviews |
| `overlap.test.ts` | 11 | 2-way and 10-way concurrent inserts, buffer boundary (15:10 rejected, 15:15 accepted), slot freed on cancel/expire |
| `booking-hold.test.ts` | ~15 | Hold creation, price snapshotting, hold limit, resume existing hold |
| `pricing-parity.test.ts` | — | TypeScript `quote()` and DB `ac_quote()` match across rate/duration matrix |
| `admin-cancel.test.ts` | — | Refund tiers, slot release, audit log |
| `admin-login.test.ts` | — | Login throttle |
| `clerk-auth.test.ts` | — | Customer bootstrap, email adoption, consent version |
| `webhook-idempotency.test.ts` | — | 3 serial/concurrent deliveries confirm exactly once; tampered body rejected |
| `failure-drill.test.ts` | — | Expired hold mid-checkout, duplicate webhook, concurrent slot grab, failed refund |

### Gaps
- No E2E / browser tests (Playwright, Cypress) — Lighthouse verification is explicitly listed as pending deployment
- No tests for admin server actions directly (underlying DB functions are tested, not the Next.js action wrappers)
- No tests for cron route handlers (only the underlying `ac_expire_holds`/`ac_complete_bookings` RPCs are tested)
- T25 (live dry run: real money, real WhatsApp, real refund) is the only remaining unchecked task

---

## 10. Build & Deployment

### Build
- `next build` — clean
- `tsc --noEmit` — clean
- `vitest run` — 139/139 passing

### Security headers (`next.config.ts`)
All routes:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`
- Full `Content-Security-Policy` (Razorpay + Clerk origins; `unsafe-inline` on `script-src` — see finding #10)

Ticket routes `/ticket/:path*`:
- `Cache-Control: private, no-store, max-age=0`
- `X-Robots-Tag: noindex, nofollow`

Admin routes `/admin/:path*`:
- `X-Robots-Tag: noindex, nofollow`

Image optimisation:
- Remote patterns restricted to Supabase companion-photos bucket only

### Cron
Both jobs run inside Postgres via `pg_cron` (migration `0014_pg_cron_schedules.sql`), not Vercel Cron. This is correct — it removes the hosting dependency and the plan limit.

| Job | Schedule | Action |
|---|---|---|
| `ac-expire-holds` | Every minute | `pending_payment` past `hold_expires_at` → `expired` |
| `ac-complete-bookings` | Hourly | `confirmed` past `ends_at` → `completed` |

### Configuration
- Transaction pooler (`DATABASE_URL`) used for serverless functions — correct
- `SUPABASE_SERVICE_ROLE_KEY` guarded by `server-only` import — build error if leaked to client
- `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` — server-only
- Anon key has two environment variable names (`NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) due to a migration shim — should be consolidated

### Deployment gaps
- Vercel project and DNS not yet configured (`docs/deployment/vercel.md` covers steps)
- `netlify.toml` present (should be removed)
- `vercel.json` essentially empty (no region, no aliases)

---

## 11. Outstanding Work & Blockers

### Code (one remaining task)
| Task | Status | Notes |
|---|---|---|
| T25 · Live dry run | `[ ]` | One real booking, real money, real WhatsApp, real refund, end to end |

### External blockers (gates T25 and launch)
| Blocker | Impact |
|---|---|
| **DLT registration** | Blocks real SMS OTP delivery — MSG91 accepts the call but the carrier drops the message silently |
| **Razorpay production credentials** | Integration built against their API but never run against a live sandbox — blocks end-to-end payment verification |
| **Vercel project + DNS** | Blocks two-host routing check and Lighthouse run |
| Entity registration → current account | Gates production payment processing |
| GST / e-commerce operator determination | Legal, not code |

---

## 12. Findings Summary

| # | Severity | Area | Finding |
|---|---|---|---|
| 1 | 🔴 High | Auth | `proxy.ts` is the actual Next.js middleware but is not named `middleware.ts` — silent auth bypass risk if file is lost |
| 2 | 🔴 High | Admin | All admin queries silently swallow DB errors, showing empty lists instead of errors |
| 3 | 🟡 Medium | Deployment | `netlify.toml` present with Vercel as stated host — wrong-host deployment risk |
| 4 | 🟡 Medium | Type safety | `any` casts on all admin query results — schema changes will fail silently at runtime |
| 5 | 🟡 Medium | Scalability | Hard `.limit(200)` on all admin list queries with no pagination |
| 6 | 🟡 Medium | Crypto | `ac_generate_reference()` uses non-CSPRNG `random()` |
| 7 | 🟡 Medium | Rate limiting | `get_availability_inputs()` RPC has no rate limit for authenticated users |
| 8 | 🟢 Low | Deployment | `vercel.json` is essentially empty |
| 9 | 🟢 Low | Documentation | `scripts/create-admin.mjs` not documented in CLAUDE.md |
| 10 | 🟢 Low | Security | CSP `unsafe-inline` on `script-src` (acknowledged, nonce-based fix deferred) |
| 11 | 🟢 Low | Monitoring | Sentry is "one DSN away" but not wired — critical payment failures currently log only |

---

## 13. Recommendations

### Do before launch

1. **Rename `proxy.ts` → `middleware.ts`** — lowest effort, highest risk if not done. Update any imports and the comment at the top of the file.

2. **Wire Sentry** — the seam is built (`lib/observability/report.ts`). Add the DSN env var and the single `Sentry.captureException()` call in the report function. A T24-style payment failure (money captured, no booking) currently only shows up in logs.

3. **Add error checking to admin queries** — check the `error` field on every Supabase call in `lib/admin/queries.ts`. Surface a toast or error boundary to the admin UI rather than silently returning empty data.

4. **Remove `netlify.toml`** — it serves no purpose and creates deployment risk.

5. **Complete T25 live dry run** after DLT registration and sandbox credentials are available.

### Do soon after launch

6. **Replace `any` casts with generated DB types** — run `supabase gen types typescript --local > lib/supabase/database.types.ts` and use the generated types in `lib/admin/queries.ts`.

7. **Add pagination to admin list views** — implement cursor-based pagination before the 200-row limit becomes reachable in production (bookings list, reviews, incidents, customers).

8. **Nonce-based CSP** — replace `unsafe-inline` on `script-src` with a per-request nonce via a custom `Document`. This is the only remaining browser security header gap.

### Backlog

9. **`get_availability_inputs()` rate limit** — add a per-user rate limit consistent with `ac_check_action_rate_limit` to prevent booking-pattern enumeration.

10. **`ac_generate_reference()` → use `gen_random_bytes()`** — replace Postgres `random()` with `encode(gen_random_bytes(4), 'hex')` or equivalent for the random component of the booking reference.

11. **E2E tests** — add Playwright tests covering the booking funnel (slot → details → checkout → webhook → confirm) once the Vercel deployment is live.

12. **Consolidate anon key env var names** — remove the `NEXT_PUBLIC_SUPABASE_ANON_KEY` shim once all consumers use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

---

*End of report.*
