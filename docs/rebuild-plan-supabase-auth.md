# AlongCo — Rebuild Plan: No Auth, Booking-as-Identity

**Date:** 2026-08-09  
**Decision:** No customer login. The booking IS the identity. Customer details
(real name, email, phone, preferences) are collected once on the booking form,
stored under the booking, and the ticket is the proof of booking.

---

## Flow

```
Landing
  └─▶ Browse companions
        └─▶ Companion profile
              └─▶ Check availability → select slot + duration
                    └─▶ Details form  ←─ THIS IS THE KEY CHANGE
                    │     name (real)
                    │     email (collected, not verified via login)
                    │     phone (real)
                    │     preferences
                    │     location / meeting area
                    │     what she wants (notes)
                    │     ☑ Accept terms
                    └─▶ Razorpay payment
                          └─▶ Ticket page  (/ticket/[reference])
                                reference AC-XXXXXX + QR code
```

The ticket is bookmarked / screenshot by the customer. She shows it to the
companion to verify. No account, no password, no login wall anywhere.

---

## What changes and what stays

### Stays exactly as-is

| Thing | Why |
|---|---|
| `bookings` table schema | All fields still needed |
| `companions`, `areas`, `settings` tables | Unchanged |
| `bookings_no_overlap` constraint | Critical, must not touch |
| `ac_quote()`, `ac_refund_quote()` | Pricing logic unchanged |
| `ac_set_booking_status()` | Status machine unchanged |
| `ac_expire_holds()` / `ac_complete_bookings()` | DB functions unchanged |
| `/api/webhooks/razorpay` route | Webhook unchanged |
| `/api/cron/*` routes | Cron endpoints unchanged |
| All admin pages and admin auth | Admin uses Supabase auth — untouched |
| `app/(public)/companions` pages | Browse and profile unchanged |
| `app/(public)/ticket` page | Ticket already exists |
| `app/(public)/policies` pages | Unchanged |
| Payment library (`lib/payments/`) | Razorpay integration unchanged |

### Changes

| Thing | Change |
|---|---|
| `customers.auth_user_id` | Drop NOT NULL / unique constraint — allow null |
| `customers` table | Add `preferences text`, `meeting_notes text` |
| `create_booking_hold()` RPC | Stop looking up customer via `ac_auth_subject()` — accept customer details as params instead |
| `lib/auth/session.ts` | Remove (or gut) — no session to manage |
| `lib/supabase/customer.ts` | Remove — no customer client needed |
| `proxy.ts` (middleware) | Remove Clerk entirely, keep admin host routing |
| `app/(public)/book/[slug]/actions.ts` | Rewrite `holdSlot` — accept form fields, create customer, create hold |
| `app/(public)/book/[slug]/details/` | Build the details form (name, email, phone, prefs, area, notes, terms) |
| `app/(public)/sign-in`, `sign-up` | Delete — not needed |
| `app/(public)/bookings` | Change to lookup-by-reference rather than "my bookings" |
| `package.json` | Remove `@clerk/nextjs` |
| RLS on `customers` and `bookings` | All reads/writes go through service-role RPCs — public policies needed only for things customers browse |
| Cron | GitHub Actions free-tier scheduler |

---

## Database migration

### Migration: `0016_no_auth_customers.sql`

```sql
-- Drop auth_user_id constraint — customers no longer have a login session.
-- The column stays so admin can still see it (it will be null for all new rows).
alter table customers
  alter column auth_user_id drop not null;

-- Drop old indexes that assumed auth_user_id is always set.
drop index if exists idx_customers_auth_user_id;

-- Recreate as a partial index (only non-null rows need it — legacy data).
create unique index idx_customers_auth_user_id
  on customers (auth_user_id)
  where auth_user_id is not null;

-- Add fields for the details form.
alter table customers
  add column if not exists preferences   text,
  add column if not exists meeting_notes text;

-- Email uniqueness: old constraint enforced case-insensitive uniqueness for
-- account adoption. Without auth we don't need account adoption — the same
-- person can book again and get a new customer row. Drop the unique index.
-- (We still store email for admin lookup and WhatsApp coordination.)
drop index if exists idx_customers_email_lower;

-- Re-add as a plain btree for admin search, not unique.
create index idx_customers_email on customers (lower(email));
```

### Updated `create_booking_hold()` function

The existing RPC calls `ac_auth_subject()` to find the customer. We replace that
with direct customer params. The RPC remains security-definer and the only path
that creates a booking row.

New signature:
```sql
create or replace function create_booking_hold(
  p_companion_slug   text,
  p_starts_at        timestamptz,
  p_duration_minutes integer,
  p_area_id          uuid,
  p_terms_version    text,
  -- Customer details (collected from form, not from a login session)
  p_full_name        text,
  p_email            text,
  p_phone            text,
  p_preferences      text  default null,
  p_customer_notes   text  default null
)
returns jsonb
```

Inside the function:
1. Validate name, email, phone are not empty
2. Look up or create customer by email (lowercase match) — if same email books
   again, reuse the row and update name/phone
3. Check `is_blocked`
4. Continue with slot validation (unchanged)
5. Create booking

Grant to `anon` — no session required.

---

## Server action rewrite

### `app/(public)/book/[slug]/actions.ts`

```typescript
'use server'
import { z } from 'zod'
import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { getSettings } from '@/lib/settings'
import { bookingErrorMessage, shouldRefreshSlots } from '@/lib/booking/errors'

const holdSchema = z.object({
  slug:            z.string().min(1),
  startsAt:        z.string().datetime({ offset: true }),
  durationMinutes: z.coerce.number().int().positive(),
  areaId:          z.string().uuid(),
  // Customer details
  fullName:        z.string().min(2),
  email:           z.string().email(),
  phone:           z.string().min(7),
  preferences:     z.string().optional(),
  customerNotes:   z.string().optional(),
})

export async function holdSlot(_prev: HoldState, formData: FormData): Promise<HoldState> {
  const parsed = holdSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? 'Check the form and try again.' }
  }

  const { slug, startsAt, durationMinutes, areaId,
          fullName, email, phone, preferences, customerNotes } = parsed.data

  const settings = await getSettings()
  const supabase = createServiceClient()

  const { data, error } = await supabase.rpc('create_booking_hold', {
    p_companion_slug:   slug,
    p_starts_at:        startsAt,
    p_duration_minutes: durationMinutes,
    p_area_id:          areaId,
    p_terms_version:    settings.termsVersion,
    p_full_name:        fullName,
    p_email:            email,
    p_phone:            phone,
    p_preferences:      preferences ?? null,
    p_customer_notes:   customerNotes ?? null,
  })

  if (error) {
    return { error: bookingErrorMessage(error), refresh: shouldRefreshSlots(error) }
  }

  const result = data as { booking_id: string }
  redirect(`/book/${slug}/pay?b=${result.booking_id}`)
}
```

---

## Booking lookup (ticket page)

The ticket page (`/ticket/[reference]`) currently reads via RLS using the
customer's auth session. Without auth, we need a different approach.

**Option A — service role + reference** (simplest):
The ticket is fetched server-side using the service client, keyed on the
reference. No session required. The reference itself (AC-XXXXXX) is the
access token — anyone who has it can see it, which is fine: the QR code is
shared with the companion.

```typescript
// lib/booking/queries.ts
export async function getBookingByReference(reference: string) {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('bookings')
    .select(SELECT)
    .eq('reference', reference.toUpperCase())
    .maybeSingle()
  return data ? shape(data) : null
}
```

**"My bookings" page:** Replace with a simple lookup form — enter the booking
reference or email to see your bookings. No login required.

---

## Middleware (proxy.ts)

Remove Clerk entirely. Keep the admin host routing and Supabase cookie refresh.

```typescript
// proxy.ts  →  middleware.ts  (rename while we're here)
import { updateSession } from '@/lib/supabase/proxy-session'

export async function middleware(request: NextRequest) {
  const host = request.headers.get('host')?.split(':')[0].toLowerCase() ?? ''
  const adminHost = (process.env.ADMIN_HOST ?? 'admin.alongco.com')
    .split(':')[0].toLowerCase()
  const { pathname } = request.nextUrl

  // Public host trying to reach admin routes → hard 404
  if (host !== adminHost && host !== 'localhost' && pathname.startsWith('/admin')) {
    return new NextResponse(null, { status: 404 })
  }

  // Admin host: rewrite bare path to /admin/* and refresh Supabase cookie
  if (host === adminHost && !pathname.startsWith('/admin')) {
    const url = request.nextUrl.clone()
    url.pathname = `/admin${pathname === '/' ? '' : pathname}`
    return updateSession(request, url)
  }

  // Admin prefix on localhost
  if (pathname.startsWith('/admin')) {
    return updateSession(request)
  }

  // Public routes: no session, no cookie refresh needed
  return NextResponse.next()
}
```

---

## Cron (free tier)

GitHub Actions runs on a schedule at zero cost.

### `.github/workflows/cron.yml`

```yaml
name: Cron Jobs

on:
  schedule:
    - cron: '* * * * *'   # every minute — expire holds
    - cron: '0 * * * *'   # every hour  — complete bookings
  workflow_dispatch:

jobs:
  expire-holds:
    runs-on: ubuntu-latest
    steps:
      - name: Expire holds
        run: |
          curl -sf -X POST \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            "${{ secrets.NEXT_PUBLIC_SITE_URL }}/api/cron/expire-holds"

  complete-bookings:
    runs-on: ubuntu-latest
    steps:
      - name: Complete bookings
        run: |
          curl -sf -X POST \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            "${{ secrets.NEXT_PUBLIC_SITE_URL }}/api/cron/complete-bookings"
```

Add `CRON_SECRET` and `NEXT_PUBLIC_SITE_URL` to GitHub repo secrets.

---

## Files to delete

```
app/(public)/sign-in/
app/(public)/sign-up/
lib/auth/session.ts          (or gutted to a stub)
lib/auth/rate-limit.ts       (holds no longer need per-customer rate limiting
                               without a session — IP-level rate limiting via
                               Vercel or a simple in-memory check is enough)
lib/supabase/customer.ts     (customer client used the Clerk token; not needed)
```

---

## RLS changes

Without auth, all customer-facing reads go through the service client (server
actions / server components). The RLS policies that used `ac_auth_subject()` can
be dropped for public tables — they served only to scope reads to the logged-in
user.

Keep:
- `settings_public_read` — settings still read by anon
- `areas_public_read` — areas still read by anon  
- `companions_public_read` — companions still read by anon
- `companion_availability_public_read` — still needed
- `companion_areas_public_read` — still needed
- `reviews_public_read` — published reviews still public
- All admin table restrictions — unchanged

Drop (no longer needed):
- `customers_select_own` — no session to scope on
- `bookings_select_own` — reads now go service-role
- `booking_events_select_own` — reads go service-role
- `reviews_select_own` — reads go service-role
- `reviews_insert_own` — inserts go through service-role server action

The net effect: customer tables are still behind RLS with no public policy
(service_role only), which is actually *stricter* than before.

---

## Implementation order

1. **Migration** `0016_no_auth_customers.sql` — drop auth constraints, add
   preferences/meeting_notes columns, update `create_booking_hold()` to accept
   customer fields directly
2. **Details form** — build `app/(public)/book/[slug]/details/` with the 6 fields
3. **Rewrite `holdSlot` server action** — call updated RPC
4. **Simplify `SlotPicker`** — "Continue" goes to details form, not direct hold
5. **Ticket lookup** — switch to service-role read by reference
6. **Bookings lookup page** — replace "my bookings" with reference/email lookup
7. **Middleware** — remove Clerk, rename `proxy.ts` → `middleware.ts`
8. **Delete** sign-in, sign-up pages and Clerk lib files
9. **`package.json`** — remove `@clerk/nextjs`
10. **GitHub Actions** — add `.github/workflows/cron.yml`
11. **Test** — `npm test && npm run build`

---

*Ready to implement — start with step 1 (migration).*
