# AlongCo — Product Requirements Document

**Version** 1.0 (MVP) · **Status** Draft, pending entity decision · **Last updated** 6 Aug 2026
**Owner** Founder · **Market** Bangalore, India

---

## 1. Problem statement

A woman in a new city, between friend groups, or simply with a free Saturday will skip
things she wants to do — a film, a gallery, a new restaurant, a long walk — because doing
them alone feels uncomfortable or unsafe. The existing options are all wrong: dating apps
carry romantic expectation, friend-finding apps require weeks of chat before anything
happens, and event meetups mean joining a group of strangers rather than having one person
alongside you.

AlongCo sells a specific, bounded thing: a booked hour with a vetted companion, in a public
place, with no romantic or sexual component, at a known price, with a clear way to end it.

**Cost of not solving it:** the demand is already served informally and unsafely through
social media DMs, with no vetting, no record, no payment protection, and no conduct
boundary. A structured version is both the product opportunity and the safety argument.

---

## 2. Goals

| # | Goal | How we know it worked |
|---|---|---|
| G1 | A first-time visitor understands what this is and what it is not within one screen | Landing → browse click-through ≥ 25% |
| G2 | A woman who decides to book can complete it in under 4 minutes | Median time from companion profile to ticket ≤ 4 min |
| G3 | Bookings actually happen — the meeting takes place as booked | Completion rate ≥ 85% of confirmed bookings |
| G4 | The conduct boundary is real and demonstrable | 100% of bookings have recorded terms acceptance; every early termination has an incident record |
| G5 | Operations run without the founder being a bottleneck | Manual confirmation dispatched within 15 min of payment, 95% of the time |

---

## 3. Non-goals (v1)

| Non-goal | Why |
|---|---|
| In-app chat between customer and companion | WhatsApp already works, is already trusted, and building chat means building moderation. Revisit only if WhatsApp handoff proves to be the drop-off point. |
| Companion self-service portal (own schedule, own profile) | Admin-managed is faster to build and keeps quality control centralised while there are fewer than ~15 companions. |
| Automated payouts to companions | Manual bank transfer for v1. Automated payouts require a payout provider, extra KYC, and an entity. |
| Native mobile app | Mobile web covers the entire audience. An app adds store review, release cycles, and no new capability. |
| Cities beyond Bangalore; areas beyond the launch three | Supply quality does not scale before demand is proven. |
| Subscriptions, packages, gift cards, referral credit | All are optimisations on a funnel that does not exist yet. |
| Ratings that affect companion ranking | Ranking algorithms need volume. v1 shows reviews; it does not rank on them. |

---

## 4. Users

**Primary — the customer.** Woman, 18–30, student or early-career professional in
Bangalore. Phone-first, arrives from Instagram, often browsing at night. Sceptical by
default and correct to be. Her decision is a safety judgment, not a purchase.

**Secondary — the companion.** Male, vetted internally, listed under a pseudonym. Needs to
know where to be, when, for whom, for how long, and that he has explicit authority to end a
booking that breaches conduct terms.

**Tertiary — the operator (admin).** Founder plus, later, one ops person. Manages
companions and pricing, sends WhatsApp confirmations by hand, resolves issues, issues
refunds, records incidents.

---

## 5. User stories

### Customer

1. As a first-time visitor, I want to understand what AlongCo is and is not within a few
   seconds, so that I can decide whether it is for me without reading a FAQ.
2. As a prospective customer, I want to see a companion's photo, description, rate, and
   reviews from real bookings, so that I can judge whether I would feel comfortable with him.
3. As a customer, I want to see exactly which times are available in the next 7 days, so
   that I can pick one without a back-and-forth.
4. As a customer, I want to know the total price before I enter any personal details, so
   that I am not surprised at checkout.
5. As a customer, I want the conduct rules stated plainly before I pay, so that I know what
   is and is not on offer and what happens if it is breached.
6. As a customer, I want a ticket with a reference I can show or download, so that I have
   proof of what I booked.
7. As a customer whose payment fails, I want to be told clearly and be able to retry without
   losing my slot immediately, so that I do not have to start over.
8. As a customer who needs to cancel, I want to know exactly what refund I get before I
   confirm the cancellation.
9. As a customer, I want to leave a review after the meeting, so that other women have
   something real to go on.

### Companion

10. As a companion, I want each booking's time, place, duration, and customer first name in
    advance, so that I arrive prepared.
11. As a companion, I want explicit authority to end a booking that breaches the conduct
    terms, with no refund owed, so that the boundary is enforceable and not just stated.

### Admin

12. As an admin, I want a queue of newly paid bookings with a pre-written confirmation
    message and the customer's WhatsApp link, so that I can dispatch confirmations quickly
    without composing each one.
13. As an admin, I want to add a companion, set his rate, working hours, and areas, and
    activate or pause him, so that supply matches demand.
14. As an admin, I want to cancel a booking and issue the correct refund according to policy
    without calculating it manually.
15. As an admin, I want to record an incident against a booking, including whether the
    booking was terminated and why, so that there is a documented enforcement record.

---

## 6. Requirements

### 6.1 Discovery — P0

- Landing page states what the service is, what it is not, how it works in three steps, and
  the price range, above the fold on a 375px screen.
- Browse page lists active companions: photo, pseudonym, hourly rate, areas served, review
  count and average rating.
- Companion profile shows photo, pseudonym, bio, rate, areas, working-hours summary, and
  published reviews.
- No companion is ever described as "verified", "background-checked", "screened", or
  equivalent anywhere in the public UI.

**Acceptance criteria**
- [ ] Given a companion with `is_active = false`, when a visitor browses, then he does not
      appear and his profile URL returns 404.
- [ ] Given a companion with `is_accepting = false`, when a visitor opens his profile, then
      the profile renders but booking is disabled with an explanation.
- [ ] Given a companion with no reviews, when a visitor opens his profile, then an empty
      state appears rather than a zero rating.

### 6.2 Availability and slots — P0

- Slots are computed on request from: weekly availability rules, minus one-off blackouts,
  minus existing bookings and their trailing buffer, bounded to `now()` … `now() + 7 days`.
- Service hours 08:00–22:00. Minimum duration 60 minutes. No extensions.
- 15-minute buffer after every booking; the next slot cannot start inside it.
- Taken slots are shown as disabled, not hidden — the cinema-seat model communicates that
  the service is real and in use.

**Acceptance criteria**
- [ ] Given a booking 14:00–15:00 with a 15-minute buffer, when slots are computed, then no
      slot starting before 15:15 is offered.
- [ ] Given a day fully booked, when the customer selects that date, then a specific empty
      state appears with the next available date offered.
- [ ] Given a slot that would end after 22:00, when slots are computed, then it is not
      offered.
- [ ] Slots are never offered in the past, including during a session left open across the
      hour boundary.

### 6.3 Identity and authentication — P0

- Phone-based OTP. One customer record per phone number.
- Auth is required before a slot hold is created, so every hold has an owner.
- Customer supplies real full name and preferred area after authentication.
- Data collected is limited to: phone, full name, chosen area, optional note. Nothing else.

**Acceptance criteria**
- [ ] OTP requests are rate-limited per phone number and per IP.
- [ ] Given an existing customer, when she authenticates again, then her prior bookings are
      visible to her and her name is pre-filled.
- [ ] Given a blocked customer, when she attempts to book, then booking is refused with a
      neutral message and no slot is held.

### 6.4 Booking and hold — P0

- Selecting a slot creates a booking in `pending_payment` with a 10-minute TTL.
- The database prevents overlapping bookings for the same companion via an exclusion
  constraint — not by UI logic.
- A cron job runs every minute and expires stale holds, returning the slot to availability.
- Price is computed server-side from the companion's current rate and snapshotted onto the
  booking. The client never supplies an amount.

**Acceptance criteria**
- [ ] Given two customers selecting the same slot within the same second, when both submit,
      then exactly one hold is created and the other receives a "just taken" message with
      the slot list refreshed.
- [ ] Given a hold created 11 minutes ago with no payment, when the cron runs, then status
      becomes `expired` and the slot is bookable again.
- [ ] Given a hold that expires while the customer is inside the payment page, when she
      returns, then she sees a clear expiry message and is returned to slot selection — she
      is never charged for an expired hold.
- [ ] Given an admin changes a companion's rate, when an existing pending booking is paid,
      then the snapshotted price is charged, not the new rate.

### 6.5 Terms acceptance — P0

Before payment, the customer must actively accept, as a checkbox and not as fine print:

- Meetings take place in public places only.
- No romantic or sexual conduct is offered or permitted.
- The companion may end the booking immediately for a breach, with no refund.
- The cancellation and refund policy, stated in full.

The accepted `terms_version` and timestamp are written to the booking record.

**Acceptance criteria**
- [ ] The pay button is disabled until the checkbox is ticked.
- [ ] The terms text is readable on the checkout screen itself, not only behind a link.
- [ ] Every booking row has a non-null `terms_version` and `terms_accepted_at`.

### 6.6 Payment — P0

- Cashfree Payment Gateway, API version `2025-01-01`. Full amount at checkout.
- Server creates the order; the browser opens checkout with the returned
  `payment_session_id`.
- **A booking is confirmed by webhook only.** The browser redirect is a UX signal, never the
  source of truth.
- Webhook signature is verified against the raw payload and timestamp header. Handlers are
  idempotent, keyed on the provider event ID.

**Acceptance criteria**
- [ ] Given a successful payment where the customer closes the browser before redirect, when
      the webhook arrives, then the booking is confirmed and appears in the admin queue.
- [ ] Given the same webhook delivered three times, when processed, then the booking is
      confirmed once and no duplicate records are created.
- [ ] Given a webhook with an invalid signature, when received, then it is rejected, logged,
      and no booking state changes.
- [ ] Given a failed payment, when the customer retries within the hold window, then she
      resumes the same booking rather than creating a second one.

### 6.7 Ticket — P0

- On confirmation the customer receives a ticket: booking reference, QR encoding the
  reference, companion pseudonym, date, time, duration, area, amount paid, and the conduct
  summary.
- Presented with a print-style reveal animation; downloadable as PDF or image.
- Accessible later from her booking history via the same reference.
- The QR is the identity handshake at the meeting, since the companion's real name is never
  shown.

**Acceptance criteria**
- [ ] The ticket contains no real name of the companion.
- [ ] The ticket is retrievable after the session ends, by the authenticated customer only.
- [ ] The animation is skipped when `prefers-reduced-motion` is set.

### 6.8 Coordination — P0 (manual)

- Confirmations are sent by hand from the WhatsApp Business app.
- The admin **confirmation queue** lists newly confirmed bookings with: a pre-formatted
  message containing the reference and meeting details, a copy button, a `wa.me` link to the
  customer's number, and a "sent" checkbox that records who sent it and when.
- The companion is contacted separately with the booking details and the customer's first
  name.
- The customer is asked to reply to the WhatsApp message, which both confirms receipt and
  creates the coordination thread.

**Acceptance criteria**
- [ ] A confirmed booking appears in the queue within seconds of the webhook.
- [ ] Bookings not marked sent within 15 minutes are visually flagged.
- [ ] Marking sent records admin identity and timestamp.

### 6.9 Cancellation and refunds — P0

| Trigger | Refund |
|---|---|
| Customer cancels ≥ 48h before start | 100% |
| Customer cancels 24–48h before start | 50% |
| Customer cancels < 24h before start | 0% |
| Companion cancels, or does not show | 100% + priority rebooking |
| Companion ends booking for conduct breach | 0% |
| Customer does not show | 0% |

- The refund amount is calculated and displayed before the customer confirms cancellation.
- Refunds are issued through Cashfree against the original payment and recorded with the
  tier applied.
- Tiers are stored in settings, not hardcoded.

**Acceptance criteria**
- [ ] Given a cancellation 47 hours before start, when the customer confirms, then 50% is
      refunded and the tier is recorded as such.
- [ ] Given any refund, when issued, then the slot returns to availability.
- [ ] A refund can never exceed the captured amount, including across partial refunds.

### 6.10 Reviews — P0

- One review per completed booking, by the customer who made it.
- Available only after `status = completed` and the end time has passed.
- Admin moderates before publication.
- "Verified review" means tied to a completed booking. It is never a claim about the
  companion.

**Acceptance criteria**
- [ ] Given a cancelled booking, when the customer attempts to review, then it is refused.
- [ ] Given an unmoderated review, when a visitor views the profile, then it is not shown.

### 6.11 Admin portal — P0

Hosted at `admin.alongco.com`, same deployment, route group behind role middleware.

| Page | Contents |
|---|---|
| Dashboard | Today's bookings, unsent confirmations, open incidents, revenue this week |
| Bookings | Search and filter; view, reschedule, cancel with refund preview, mark no-show |
| Confirmation queue | As 6.8 |
| Companions | Create, edit, photo, rate, weekly hours, blackouts, areas, activate/pause; internal identity and vetting notes in a restricted panel |
| Customers | Booking history, block/unblock, handle deletion requests |
| Payments & payouts | Cashfree reconciliation, refunds issued, per-companion amount owed, mark paid with UTR |
| Reviews | Moderate, publish, unpublish |
| Incidents | Record and resolve; linked to booking, companion, customer |
| Settings | Areas, buffer, hold duration, booking window, refund tiers, admin users, audit log |

**Acceptance criteria**
- [ ] Every state-changing admin action writes to the audit log with admin identity.
- [ ] A non-admin authenticated customer hitting an admin URL is refused, not redirected to
      a login that would accept her.

### 6.12 Policy pages — P0

Terms of service · Cancellation and refund policy · Privacy notice (DPDP-compliant, with
purpose, retention, deletion path, and named grievance contact) · Conduct policy. All
written in plain language and readable on a phone. A published refund policy is also a
Cashfree onboarding requirement.

### 6.13 P1 — fast follows

- Customer booking history with rebook-in-one-tap.
- Automated WhatsApp confirmations via Cloud API, replacing the manual queue.
- Reschedule by the customer (currently admin-only).
- Companion-side view of his own upcoming bookings.
- Waitlist for a fully-booked companion.

### 6.14 P2 — design for, do not build

- Automated companion payouts.
- Second city.
- Companion self-service scheduling.
- Group bookings (two friends, one companion).

---

## 7. Business rules summary

| Rule | Value |
|---|---|
| Minimum duration | 60 minutes |
| Service hours | 08:00–22:00 IST |
| Booking window | Rolling 7 days |
| Buffer between bookings | 15 minutes |
| Payment hold | 10 minutes |
| Payment timing | Full amount upfront |
| Launch areas | MG Road, Indiranagar, Cubbon Park |
| Companion identity | Pseudonym + real current photo |
| Extensions | Not permitted |

---

## 8. Technical requirements

**Stack** Next.js App Router on Vercel · Supabase Postgres, Auth, Storage · Cashfree PG
`2025-01-01` · WhatsApp Business app (manual) · Google Analytics.

**Data model** As specified in `schema.sql`. Key invariants:
- `bookings_no_overlap` GiST exclusion constraint enforces non-overlap at the database level.
- `companion_identities` is a separate table, service-role only, never joined into any
  client-facing query.
- All money in paise as integers. No floats anywhere in the payment path.
- Booking creation happens through a security-definer RPC, never a direct client insert.

**Security**
- RLS enabled on every table, deny by default.
- Customers can read only their own rows.
- Payments, refunds, incidents, identities, and the audit log are service-role only.
- Rate limiting on OTP requests and booking creation.

**Background jobs (Vercel Cron)**
1. Every minute — expire holds past `hold_expires_at`.
2. Hourly — mark confirmed bookings past `ends_at` as completed.

**Performance and platform**
- Mobile-first, designed at 375px; single breakpoint at 768px.
- Companion listing served from server components and cached.
- Supabase transaction pooler connection string (serverless-safe).
- Target: landing LCP under 2.5s on a mid-range Android over 4G.

---

## 9. Compliance

**DPDP Act 2023 — applies.** Consent notice at the point of collection; stated purpose;
retention period; deletion request path; named grievance contact. Collect phone, name, and
area only.

**Entity and payments — BLOCKING.** Cashfree requires proof of business existence (GSTIN,
shop and establishment certificate, or Udyam) and reclassifies applicants without it as
"Unregistered". Cashfree also inspects the live website to assign a merchant category code.
An unregistered application for a service in this category is the weakest possible
submission. A sole proprietorship — not a company — resolves this in days and enables a
current account.

**GST.** Collecting payment on behalf of others' services likely makes AlongCo an
e-commerce operator, which triggers mandatory GST registration regardless of turnover.
Requires confirmation from a CA before launch.

**Conduct enforcement.** The public conduct policy must be operationally real: accepted at
checkout, restated at confirmation, the companion holds explicit termination authority, and
every termination produces an incident record. A stated policy with no enforcement record is
worse than no policy.

*Nothing in this section is legal advice. All three items need a lawyer and a CA before
launch.*

---

## 10. Success metrics

**Leading (first 30 days)**
| Metric | Success | Stretch |
|---|---|---|
| Landing → browse | 25% | 40% |
| Profile → slot selection | 30% | 45% |
| Slot → payment initiated | 60% | 75% |
| Payment initiated → confirmed | 80% | 90% |
| Median profile → ticket | ≤ 4 min | ≤ 2.5 min |
| Confirmation dispatched within 15 min | 95% | 99% |

**Lagging (90 days)**
| Metric | Success |
|---|---|
| Booking completion rate | ≥ 85% |
| Repeat booking rate | ≥ 20% |
| Average rating | ≥ 4.3 |
| Incidents per 100 bookings | < 3 |
| Refund rate | < 10% |

**Counter-metric:** incidents per 100 bookings rising while ratings stay high would mean
the review system is not surfacing problems. Watch both together.

---

## 11. Phasing

| Phase | Contents | Blocks |
|---|---|---|
| 0 — Unblock | Entity registration, current account, Cashfree application, domain, WhatsApp Business account | Everything downstream. Start immediately, in parallel with design. |
| 1 — Design | 8 public screens, 9 admin screens, design system, in Claude Design | Build |
| 2 — Foundation | Schema, RLS, auth, admin shell, companion management | Booking |
| 3 — Booking core | Availability, hold, Cashfree, webhook, ticket | Launch |
| 4 — Ops | Confirmation queue, refunds, incidents, reviews | Launch |
| 5 — Hardening | Rate limiting, monitoring, policy pages, live dry-run booking with real money | Launch |

**Critical path is Cashfree onboarding, not code.** Submit in week 1. A rejection discovered
in week 6 with everything else built is the failure mode to avoid.

---

## 12. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Cashfree rejects the merchant category or the unregistered application | Fatal — no revenue | Register a proprietorship, apply in week 1, have the site's copy and policy pages ready for underwriting review |
| Supply quality — a single bad companion | Severe reputational and legal exposure | Real vetting before listing, signed conduct agreement, incident log, immediate deactivation |
| Manual confirmation is missed | Customer pays and hears nothing | 15-minute flag in the queue, ticket on-site as the real confirmation |
| Double-booking | Two customers, one companion, in person | Database exclusion constraint, explicitly load-tested |
| Trust never establishes; traffic does not convert | No business | Landing page is the highest-leverage screen; test copy before scaling spend |
| Conduct boundary is tested by customers | Legal and safety exposure | Terms at checkout, companion termination authority, no refund on breach, documented incidents |

---

## 13. Open questions

**Blocking**
1. Entity — proprietorship or continue unregistered? Blocks Cashfree, blocks launch. *(Founder, this week)*
2. GST / e-commerce operator status — does mandatory registration apply? *(CA)*
3. Refund tiers in §6.9 — approved as written, or different numbers? *(Founder)*

**Non-blocking**
4. OTP delivery: SMS with DLT registration, or email OTP for MVP? *(Founder / engineering)*
5. Companion compensation model — fixed hourly, percentage split, or per-booking fee? *(Founder)*
6. Does the customer see the companion's phone number, or does all coordination route through
   the business number? Recommendation: business number, for the record it creates. *(Founder)*
7. Photo standards for companion profiles — who shoots them, what is the consistency bar? *(Design)*
8. Cancellation by companion — how is a replacement offered, and by whom? *(Ops)*

---

## 14. Appendix — related documents

- `schema.sql` — full Postgres schema with constraints and RLS sketch
- `design-brief.md` — design direction and screen inventory for the design phase
