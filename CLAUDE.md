# AlongCo

Booking platform. Women in Bangalore book a vetted companion for an hour or more of
non-romantic company in a public place. Mobile-first web, no app.

Read this file before writing any code. The invariants in §3 are not style preferences —
breaking one produces either a legal problem, a double-booked customer, or a lost payment.

---

## 1. Stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router), TypeScript, React Server Components by default |
| Styling | Tailwind CSS + shadcn/ui |
| Database | Supabase Postgres (RLS on every table) |
| Auth | Supabase Auth, phone OTP over SMS via MSG91 (Send-SMS auth hook) |
| Storage | Supabase Storage — `companion-photos` (public), `companion-docs` (private) |
| Payments | Cashfree Payment Gateway, API version `2025-01-01` |
| Messaging | WhatsApp Business **app**, sent manually by an admin. No API integration in v1. |
| Hosting | Vercel + Vercel Cron |
| Analytics | Google Analytics |

Use the Supabase **transaction pooler** connection string. Serverless functions exhaust
direct connections.

---

## 2. Repo layout

```
app/
  (public)/                  # alongco.com
    page.tsx                 # landing
    companions/page.tsx      # browse
    c/[slug]/                # profile        (design canvas URL)
    book/[slug]/             # slot picker -> details -> checkout
    review/[reference]/      # leave a review after a completed booking
    t/[reference]/           # ticket         (design canvas URL)
    policies/                # terms, refunds, privacy, conduct
  (admin)/                   # admin.alongco.com via middleware host check
    dashboard/ bookings/ confirmations/ companions/
    customers/ payments/ reviews/ incidents/ settings/
  api/
    webhooks/cashfree/route.ts
    cron/expire-holds/route.ts
    cron/complete-bookings/route.ts
lib/
  supabase/{server,client,service}.ts
  cashfree/{orders,refunds,verify}.ts
  booking/{availability,hold,pricing,refund-tiers}.ts
  whatsapp/message-templates.ts   # plain strings, copied by hand
supabase/migrations/
components/ui/               # shadcn
```

Domain logic lives in `lib/`, never in components. Every rule in §4 must be testable
without rendering anything.

---

## 3. Hard invariants

**Never break these.**

1. **The client never sends a price.** Amounts are computed server-side from
   `companions.hourly_rate_paise` and snapshotted onto the booking at creation.
2. **Money is integer paise.** No floats, no `Number.toFixed` arithmetic, anywhere in the
   payment path.
3. **A booking is confirmed by verified webhook only.** The browser redirect after Cashfree
   checkout is a UX signal. It never sets `confirmed`.
4. **Webhook handlers are idempotent**, keyed on the provider event ID in `webhook_events`.
   Cashfree retries.
5. **Overlap prevention lives in the database** (`bookings_no_overlap`, a GiST exclusion
   constraint). Never rely on UI filtering or a read-then-write check.
6. **`companion_identities` is service-role only.** Real names, phone numbers, and ID
   documents never appear in a client-facing query, API response, ticket, or log line.
7. **The word "verified" is never applied to a companion** in any UI copy. There is no
   background-check infrastructure behind that claim. "Verified review" is allowed and means
   the review is tied to a completed booking.
8. **Conduct terms are accepted at checkout**, and `terms_version` + `terms_accepted_at` are
   written to every booking. A booking row without them is a bug.
9. **RLS is on for every table, deny by default.** Booking creation goes through a
   security-definer RPC, not a client insert.
10. **Refund tiers, buffer, hold duration, and booking window come from the `settings`
    table**, never hardcoded.
11. **Refunds are exact paise, never rounded to the rupee.** Pricing rounds to the whole
    rupee (₹898, ₹1,048); a 50% refund of ₹499 is ₹249.50. Two different rules, on
    purpose — see the comment on `ac_refund_quote`.
12. **Companion payouts are settled manually, outside the product.** The payments screen
    reconciles what Cashfree did and reports hours delivered. It never computes an
    amount owed.

---

## 4. Business rules

| Rule | Value |
|---|---|
| Minimum duration | 60 minutes |
| Service hours | 08:00–22:00 IST |
| Booking window | Rolling 7 days from now |
| Buffer after each booking | 15 minutes |
| Payment hold TTL | 10 minutes |
| Payment | Full amount upfront |
| Base rate | ₹499/hour (per-companion, admin-set) |
| Duration discount | 10% from 2 hours, 30% from 3 hours (`settings.duration_discounts`) |
| Areas | MG Road, Indiranagar, Cubbon Park |
| Extensions | Not permitted |
| Companion identity | Pseudonym + photo only |

**Refund tiers** (from `settings.refund_tiers`):

| Trigger | Refund |
|---|---|
| Customer cancels ≥48h before | 100% |
| Customer cancels 24–48h before | 50% |
| Customer cancels <24h before | 0% |
| Companion cancels or no-shows | 100% |
| Companion ends booking for conduct breach | 0% |
| Customer no-show | 0% |

**Availability is computed, never stored.** There is no slots table. Derive from
`companion_availability` − `companion_blackouts` − existing bookings and their buffers,
bounded to the 7-day window.

---

## 5. Design tokens

From the Claude Design canvases. Put these in `tailwind.config.ts` and use the names, not
raw hex, in components.

```ts
colors: {
  ink:    { DEFAULT: '#16161A', deep: '#101116' },
  paper:  { DEFAULT: '#FBFAF7', warm: '#F7F6F2', sunk: '#F5F4F0', edge: '#ECEBE6' },
  blue:   { DEFAULT: '#2E63E8', dark: '#2E4FA8', soft: '#9DB4F6', tint: '#EDF1FD' },
  rose:   { DEFAULT: '#F76D8A', deep: '#C7456B', tint: '#FDEFF3' },
  violet: { DEFAULT: '#8A6BEF' },
  green:  { DEFAULT: '#1F7A5A', tint: '#E8F5EF' },
  amber:  { DEFAULT: '#8A6A22', tint: '#FBF2DC' },
}
fontFamily: {
  sans:  ['Public Sans', 'system-ui', 'sans-serif'],   // all UI
  serif: ['Newsreader', 'Georgia', 'serif'],           // display headings only
  mono:  ['ui-monospace', 'Menlo', 'monospace'],       // references, ticket numbers
}
```

Semantic use: blue = primary action and links · rose = the brand accent and the ticket ·
green = confirmed and success · amber = warning and pending · ink on paper for everything
else.

Design at **375px first**. One breakpoint at `md` (768px). Desktop is an adaptation.

The aurora background on the landing hero, the grain overlay, and the ticket print
animation are all in the design files — reproduce them, and gate every one behind
`prefers-reduced-motion: reduce`.

---

## 6. Conventions

- Server Components by default. `'use client'` only for interactive leaves (slot picker,
  checkout, forms).
- Mutations are **server actions**, not route handlers. Route handlers are for webhooks and
  cron only.
- Validate every server action input with Zod at the boundary.
- Times are `timestamptz` in the database, rendered in IST. Never store naive local time.
- Booking references are human-readable and unambiguous: `AC-` + 6 chars from a
  Crockford-style alphabet with no `I`, `O`, `1`, `0`.
- Every state-changing admin action writes to `admin_audit_log`.
- Every booking status change writes to `booking_events`.
- Errors surface as specific user-facing messages. Never "Something went wrong" on the
  payment or slot path — the user needs to know whether her money moved.

---

## 7. Environment

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # server only, never imported into a client component
DATABASE_URL=                     # transaction pooler
CASHFREE_APP_ID=
CASHFREE_SECRET_KEY=
CASHFREE_ENV=sandbox              # sandbox | production
CASHFREE_WEBHOOK_SECRET=
CRON_SECRET=                      # verified on /api/cron/* routes
NEXT_PUBLIC_SITE_URL=
ADMIN_HOST=admin.alongco.com
```

---

## 8. Cron

| Route | Schedule | Job |
|---|---|---|
| `/api/cron/expire-holds` | every minute | `pending_payment` past `hold_expires_at` → `expired` |
| `/api/cron/complete-bookings` | hourly | `confirmed` past `ends_at` → `completed` |

Both verify `CRON_SECRET` before doing anything.

---

## 9. Do not

- Do not use `localStorage` or `sessionStorage` for booking state. Server is the source of
  truth; a hold survives a refresh.
- Do not add scarcity UI ("only 2 slots left"), countdown pressure, testimonial carousels,
  or dark patterns on the cancellation path. The audience is deciding on safety, not
  buying a deal.
- Do not add a chat feature. Coordination is WhatsApp, by hand, in v1.
- Do not build companion self-service. Admin-managed in v1.
- Do not expose an admin route to an authenticated customer — refuse, don't redirect to a
  login that would accept her.
- Do not log phone numbers, real names, or full payment payloads.

---

## 10. Reference

- `supabase/migrations/0001_init.sql` — schema, constraints, RLS sketch
- `docs/prd.md` — full requirements with acceptance criteria
- `docs/design/` — the two Claude Design canvases (public, admin)

When a requirement here and the PRD disagree, the PRD wins — and fix this file.
