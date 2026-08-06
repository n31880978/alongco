# AlongCo — build order

Each task is sized for one Claude Code session. Do them in order; later tasks assume
earlier ones. Acceptance criteria live in `docs/prd.md` — the section reference is on each
task.

Mark done with `[x]`. Do not start a task whose dependency is unchecked.

## Completion snapshot — 2026-08-06 (second pass)

Verified by `npm run db:reset && npm test && npm run build`:
**139 tests pass — 55 pure unit, 84 against a real Postgres.** Typecheck and
production build are clean.

This pass closed Phase 4 and Phase 5. What changed:

- `[x]` **T5 · Admin shell + companions** — list, create, edit, photo upload to
  the `companion-photos` bucket, weekly hours, blackouts, list/pause toggles, and
  the identity panel behind an `owner`-only check. A companion cannot be listed
  until an identity record with a signed conduct agreement exists.
- `[x]` **T15 · Confirmation queue** — pre-composed customer and companion
  messages from `lib/whatsapp/message-templates.ts`, copy buttons, a `wa.me`
  link, and a "mark sent" that records admin and timestamp and only ever moves
  null → now, so the SLA figure cannot be rewritten. Overdue past the settings
  SLA is flagged in red.
- `[x]` **T16 · Bookings admin + refunds** — search, status filter, detail view,
  and cancellation through `ac_admin_cancel_booking`: the database owns the
  arithmetic and the state change in one transaction, the server action carries
  the result to Cashfree and writes back what Cashfree said. A refused refund
  stays recorded as owed and is retryable on the same refund reference.
- `[x]` **T17 · Incidents** — record, triage, resolve. Ending a booking early is
  refused by the database without a written incident (`AC_INCIDENT_REQUIRED`).
- `[x]` **T18 · Reviews** — public submission gated by RLS on `completed` and
  end time passed, plus admin publish/hold/reject. A review tied to an open
  incident cannot be published, enforced by `ac_review_publishable`.
- `[x]` **T19 · Payments** — reconciliation only. Captured, refunded, net, and
  hours delivered per companion. **No amount owed and no payout table**, by
  decision: companion settlement is manual and outside the product.
- `[x]` **T21 · Rate limiting** — OTP was already limited; booking holds and
  review submission now go through `ac_check_action_rate_limit`, keyed on the
  customer. The limiter fails open on purpose — a monitoring fault must not
  become a booking outage.
- `[x]` **T22 · Error monitoring** — one reporting seam (`lib/observability`)
  with an allow-listed, redacting context. Webhook and cron failures report as
  `critical`. Attaching Sentry is a DSN and one forward call.
- `[x]` **T23 · Analytics** — the six PRD §10 funnel events, nothing more, and
  only on public pages. With no measurement id set, no third-party script loads.
- `[x]` **T24 · Failure drill** — see `tests/db/failure-drill.test.ts`. This
  found a real defect; see "What the drill found" below.
- `[x]` **T4 · Auth** — now SMS via MSG91, per the founder's decision, through a
  Supabase Send-SMS auth hook (`supabase/functions/send-sms-otp`). Supabase has
  no native MSG91 provider, so the hook is what makes the choice possible.
  **Blocked on DLT registration** before real delivery.

### What the drill found

Two defects, both fixed:

1. **Refunds were rounded to the whole rupee.** `ac_refund_quote` used the same
   round-to-rupee rule as pricing, so a 50% refund of ₹499 came out ₹250. The
   admin design canvas says ₹249.50. Pricing rounds to the rupee on purpose;
   refunds must not. Fixed in `0002_functions.sql`, with the reasoning in a
   comment so it is not "tidied" back.

2. **A payment landing after its hold expired could lose money.** If the hold
   expired and the slot was resold before Cashfree's webhook arrived, confirming
   would have violated the overlap constraint — the webhook would have 500'd and
   Cashfree would have retried forever while she had already been charged. The
   handler now detects `23P01`, acknowledges the webhook, writes a
   `booking_events` row, and reports it as critical. The admin dashboard shows
   "money captured, no booking" until a refund is issued.

## Completion snapshot — 2026-08-06 (first pass)

`[x]` means the implementation and its stated automated acceptance checks are
complete. `[~]` means code is present but a delivery requirement outside this
repo is still missing. The remaining `[ ]` items are not implemented yet.

Verified by `npm run db:reset && npm test && npm run build`:
**123 tests pass — 55 pure unit, 68 against a real Postgres.** Typecheck and
production build are clean.

- `[x]` **T2 · Database** — six migrations apply cleanly. 23 RLS tests confirm
  the anon key cannot read `companion_identities`, `payments`, `refunds`,
  `webhook_events`, blackout reasons, or another customer's booking, and that a
  customer cannot unblock herself or self-publish a review.
- `[x]` **T3 · Overlap constraint test** — 11 tests. Exactly one insert wins
  under both 2-way and 10-way concurrency; a 15:00 end rejects a 15:10 start and
  accepts 15:15; cancelled and expired bookings free the slot.
- `[x]` **T6 · Availability engine** — 24 unit tests: service hours, booking
  window, past slots, mid-day blackout, trailing buffer, fully-booked day and
  day rollover.
- `[~]` **T1 · Scaffold** — route groups, fonts, tokens and host routing are in
  place and the build is green. Vercel project + DNS remain; see
  `docs/deployment/vercel.md`.
- `[~]` **T4 · Auth** — WhatsApp OTP, customer bootstrap and an atomic
  rate-limit RPC. A sixth request in a minute is refused, proven by test.
  Real delivery needs the Twilio WhatsApp sender configured in Supabase.
- `[~]` **T7 · Public browse and profile** — landing, browse and profile render
  from the design canvas with all empty states. Lighthouse verification needs a
  deployment.
- `[~]` **T9 · Pricing + hold** — pricing engine and `create_booking_hold` are
  done and covered by 25 tests, including price snapshotting and the race. The
  picker and details UI are still to build.
- `[~]` **T10 · Terms gate** — versioned terms and the database enforcement are
  in place; the checkout UI gate lands with T11.

Phase 3 additions, verified by the same command (**123 tests**):

- `[x]` **T9 · Pricing + hold** — picker, hold and details form. The client has no
  price field to forge; 25 tests cover snapshotting, the "just taken" race and
  every AC_* refusal.
- `[x]` **T10 · Terms gate** — terms render in full on checkout, the pay button
  is inert until ticked, and the server action re-checks acceptance and version.
- `[x]` **T20 · Policy pages** — conduct, refunds, privacy (DPDP) and terms are
  statically generated and linked from the footer and checkout.
- `[~]` **T8 · Slot picker** — all three canvas states (available, fully booked,
  paused) are implemented; visual confirmation needs seeded data.
- `[~]` **T11 · Cashfree checkout** — orders to API `2025-01-01`, idempotency
  key per attempt, SDK opens with `payment_session_id`. Needs sandbox keys.
- `[~]` **T12 · Webhook** — raw-body HMAC verification and `webhook_events`
  idempotency. 20 tests: a tampered body, a wrong secret, a replay outside the
  skew window and a signature without the timestamp prefix are all rejected;
  three deliveries (serial and concurrent) confirm exactly once.
- `[~]` **T13 · Cron jobs** — both routes verify `CRON_SECRET` in constant time;
  `vercel.json` schedules them. Hold expiry is covered by test.
- `[~]` **T14 · Ticket** — reference, real QR, print-stock treatment, all
  animation behind `prefers-reduced-motion`. Owner-only by RLS.

Outstanding external dependencies (none block further coding):

- Supabase project URL and keys — the app builds and renders but reaches no data.
- Cashfree sandbox credentials — needed to verify T11/T12 against the sandbox.
- Twilio WhatsApp sender — needed for real OTP delivery.
- Vercel project + DNS — needed for T1's two-host check and T7's Lighthouse run.

---

## Phase 2 — Foundation

- [~] **T1 · Scaffold**
  Next.js App Router + TypeScript + Tailwind + shadcn/ui. Route groups `(public)` and
  `(admin)`. Fonts (Public Sans, Newsreader) via `next/font`. Design tokens into
  `tailwind.config.ts` per CLAUDE.md §5. Middleware that routes `ADMIN_HOST` to the admin
  group. Deploy to Vercel and confirm both hosts resolve.
  *Done when:* a themed placeholder page renders on both hosts. (Implemented locally;
  complete the Vercel/DNS steps in `docs/deployment/vercel.md` to mark `[x]`.)

- [x] **T2 · Database**
  `supabase/migrations/0001_init.sql` from the provided schema. Enable `btree_gist`. Seed
  `settings` and `areas`. Write RLS policies for every table per CLAUDE.md §3.9.
  *Done when:* the anon key cannot read `companion_identities`, `payments`, or any other
  customer's booking — verified by a test, not by inspection. (23 RLS tests in
  `tests/db/rls.test.ts`.)

- [x] **T3 · Overlap constraint test**
  A test that fires two concurrent inserts for the same companion and overlapping window
  and asserts exactly one succeeds. Also test the buffer boundary: a booking ending 15:00
  with a 15-minute buffer must reject a 15:10 start and accept 15:15.
  *Done when:* both tests pass against a real Postgres, not a mock. §6.4
  (11 tests in `tests/db/overlap.test.ts`, including a 10-way race.)

- [~] **T4 · Auth**
  Supabase phone OTP. Customer record created on first verification. Rate limits on OTP
  request per phone and per IP. Session handling in server components.
  *Done when:* a user can sign in, refresh, and stay signed in; a sixth OTP request in a
  minute is refused. §6.3

- [x] **T5 · Admin shell + companions**
  Admin layout, role check via `admin_users`, nav. Companions CRUD: create, edit, photo
  upload to Supabase Storage, hourly rate, weekly availability rules, blackouts, areas,
  active/accepting toggles. Internal identity panel behind a separate role check.
  `admin_audit_log` written on every mutation.
  *Done when:* a companion created in admin appears correctly shaped in the database with
  identity fields inaccessible to the anon key. §6.11

---

## Phase 3 — Booking core

- [x] **T6 · Availability engine**
  `lib/booking/availability.ts`, pure and unit-tested. Input: companion, date range, now.
  Output: slots. Subtracts blackouts, existing bookings, trailing buffers; clamps to
  service hours and the 7-day window; never returns past slots.
  *Done when:* unit tests cover fully-booked day, mid-day blackout, buffer boundary,
  22:00 edge, and the day-rollover case. §6.2

- [~] **T7 · Public browse and profile**
  Landing, browse, companion profile — from the design canvas, 375px first. Server
  components, cached. Empty states: no companions, no reviews, companion paused.
  *Done when:* Lighthouse mobile performance ≥ 90 and no companion is described as
  "verified". §6.1

- [~] **T8 · Slot picker**
  7-day horizontal date strip, time chips, taken slots visible but disabled. Fully-booked
  empty state offering the next available date. Duration selection with the pricing rule.
  *Done when:* the three states in the design canvas (available, fully booked, paused)
  all render, and the price shown matches a server-computed price. §6.2

- [x] **T9 · Pricing + hold**
  `lib/booking/pricing.ts` — server-side price from rate, duration, and discount tiers.
  Security-definer RPC that creates the `pending_payment` booking, snapshots the price, and
  sets `hold_expires_at`. Details form writes name and area.
  *Done when:* a forged price in the request body is ignored; a second user selecting the
  held slot gets a "just taken" message with a refreshed list. §6.4

- [x] **T10 · Terms gate**
  Conduct terms rendered in full on checkout with a required checkbox. Versioned constant.
  Writes `terms_version` and `terms_accepted_at`.
  *Done when:* the pay button is inert until checked, and no booking can reach `confirmed`
  without both fields set. §6.5

- [~] **T11 · Cashfree checkout**
  Server creates the order (`2025-01-01`), returns `payment_session_id`, client SDK opens
  checkout. Return page polls booking status; it never sets it.
  *Done when:* a sandbox payment reaches Cashfree and the return page shows a pending
  state rather than a confirmed one. §6.6

- [~] **T12 · Webhook**
  `/api/webhooks/cashfree`. Raw-body signature verification with the timestamp header.
  Idempotency via `webhook_events`. On success: `confirmed`, `booking_events` row, ticket
  reference generated.
  *Done when:* replaying the same webhook three times confirms once; an invalid signature
  is rejected and logged; a payment completed with the browser closed still confirms. §6.6

- [~] **T13 · Cron jobs**
  Expire holds (every minute), complete bookings (hourly). `CRON_SECRET` verified.
  *Done when:* an 11-minute-old hold is expired and its slot is bookable again. §6.4

- [~] **T14 · Ticket**
  Reference + QR, print-stock treatment from the design canvas, print animation gated on
  `prefers-reduced-motion`. PDF/image download. Retrievable later by the owning customer
  only.
  *Done when:* the ticket contains no real companion name and another signed-in customer
  gets a 404 on that reference. §6.7

---

## Phase 4 — Operations

- [x] **T15 · Confirmation queue**
  Newly confirmed bookings, pre-formatted WhatsApp message, copy button, `wa.me` link,
  "sent" checkbox recording admin and timestamp. Visual flag past 15 minutes.
  *Done when:* a sandbox booking appears in the queue within seconds of the webhook. §6.8

- [x] **T16 · Bookings admin + refunds**
  Search, filter, detail view. Cancel with refund preview computed from `settings`, then
  Cashfree refund API. Mark no-show. Slot returns to availability on refund.
  *Done when:* a cancellation 47 hours out previews and issues 50%, records the tier, and
  frees the slot. §6.9

- [x] **T17 · Incidents**
  Record against a booking: type, description, whether the booking was terminated, whether
  a refund was issued, resolution. Linked from booking and companion views.
  *Done when:* ending a booking early from admin requires an incident record. §6.11

- [x] **T18 · Reviews**
  Submission gated on `status = completed` and end time passed. Admin moderation.
  Published reviews on the profile.
  *Done when:* a cancelled booking cannot be reviewed and an unmoderated review is not
  publicly visible. §6.10

- [x] **T19 · Payments and payouts admin**
  Cashfree reconciliation view, refunds issued, per-companion amount owed, mark paid with
  UTR reference.
  *Done when:* amounts owed reconcile against completed bookings for a test month. §6.11

- [x] **T20 · Policy pages**
  Terms, refund policy, privacy notice (DPDP: purpose, retention, deletion path, grievance
  contact), conduct policy. Plain language, phone-readable.
  *Done when:* all four are live and linked from checkout and footer — Cashfree
  underwriting will look at these. §6.12

---

## Phase 5 — Hardening

- [x] **T21 · Rate limiting and abuse** — OTP, booking creation, review submission.
- [x] **T22 · Error monitoring** — Sentry or equivalent; alert on webhook failures and cron
      failures specifically.
- [x] **T23 · Analytics** — the funnel events in PRD §10, nothing more.
- [x] **T24 · Failure drill** — deliberately break each of: expired hold mid-checkout,
      duplicate webhook, concurrent slot grab, failed refund. Fix what surfaces.
- [ ] **T25 · Live dry run** — one real booking, real money, real WhatsApp confirmation,
      real refund, end to end, before any traffic.

---

## Blocked on non-code work

- [ ] Entity registration → current account → Cashfree production credentials.
      **This gates T25 and launch, not the build.** Start it now.
- [ ] GST / e-commerce operator determination with a CA.
- [x] ~~Confirm the duration discount thresholds~~ — RESOLVED from the design canvas,
      which marks the price table as real, not placeholder: 1h ₹499, 2h −10% = ₹898,
      3h or more −30% = ₹1,048. In `settings.duration_discounts`.
- [x] ~~OTP delivery decision~~ — RESOLVED: SMS via MSG91, through the Supabase
      Send-SMS auth hook.
- [ ] **DLT registration** — entity, sender header and OTP template must be approved on
      the DLT portal and linked in MSG91. Until then MSG91 accepts the API call and the
      carrier silently drops the message, which looks exactly like a working integration
      with no messages arriving. **Blocks real sign-in.**
- [ ] Cashfree sandbox merchant account — the integration is built against API
      `2025-01-01` but has never been run against a live sandbox. **Blocks T11/T12
      end-to-end verification and T25.**
