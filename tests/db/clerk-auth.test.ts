import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  asRole,
  closePool,
  createArea,
  createCompanion,
  currentTermsVersion,
  insertBookingSql,
  query,
  resetData,
} from '../helpers/db'

/**
 * Clerk subjects are not uuids — 0013.
 *
 * The whole migration exists because auth.uid() casts the JWT subject to uuid.
 * The pre-existing RLS suite uses uuid subjects, so it would keep passing even
 * if the migration had done nothing: a uuid string matches a text column
 * perfectly well. These tests use a real Clerk-shaped id instead, which is the
 * only thing that distinguishes a working migration from a broken one.
 */

const CLERK_SUB = 'user_2abcDEF456ghiJKL789mnoPQR'
const OTHER_CLERK_SUB = 'user_2zzzZZZ000yyyYYY111xxxWWW'

let areaId: string
let companionId: string
let terms: string

async function createClerkCustomer(subject: string, email: string): Promise<string> {
  const [{ id }] = await query<{ id: string }>(
    `insert into customers (auth_user_id, email, full_name, phone)
     values ($1, $2, 'Test Customer', null) returning id`,
    [subject, email],
  )
  return id
}

async function seedBooking(customerId: string, hoursOut = 30): Promise<string> {
  const startsAt = new Date(Date.now() + hoursOut * 3600_000)
  const endsAt = new Date(startsAt.getTime() + 3600_000)
  const [{ id }] = await query<{ id: string }>(insertBookingSql(), [
    `AC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    customerId,
    companionId,
    areaId,
    startsAt.toISOString(),
    endsAt.toISOString(),
    15,
    'confirmed',
    49900,
    49900,
    terms,
  ])
  return id
}

beforeEach(async () => {
  await resetData()
  areaId = await createArea()
  companionId = await createCompanion({ areas: [areaId] })
  terms = await currentTermsVersion()
})

afterAll(closePool)

describe('ac_auth_subject', () => {
  it('returns a Clerk id verbatim, without attempting a uuid cast', async () => {
    const [row] = await asRole('authenticated', { sub: CLERK_SUB }, (client) =>
      client
        .query<{ subject: string }>(`select ac_auth_subject() as subject`)
        .then((r) => r.rows),
    )
    expect(row.subject).toBe(CLERK_SUB)
  })

  it('is null for an anonymous request rather than raising', async () => {
    const [row] = await asRole('anon', null, (client) =>
      client
        .query<{ subject: string | null }>(`select ac_auth_subject() as subject`)
        .then((r) => r.rows),
    )
    expect(row.subject).toBeNull()
  })

  /**
   * The exact failure this migration was written to prevent. If anything
   * reintroduces auth.uid() on the customer path, this is what a real customer
   * would hit on every single request.
   */
  it('confirms auth.uid() would have thrown on the same subject', async () => {
    await expect(
      asRole('authenticated', { sub: CLERK_SUB }, (client) =>
        client.query(`select auth.uid()`),
      ),
    ).rejects.toThrow(/invalid input syntax for type uuid/i)
  })
})

describe('RLS with a Clerk subject', () => {
  it('lets her read her own customer row', async () => {
    await createClerkCustomer(CLERK_SUB, 'ananya@example.com')

    const rows = await asRole('authenticated', { sub: CLERK_SUB }, (client) =>
      client.query(`select id, email from customers`).then((r) => r.rows),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].email).toBe('ananya@example.com')
  })

  it('hides another customer’s row', async () => {
    await createClerkCustomer(CLERK_SUB, 'ananya@example.com')
    await createClerkCustomer(OTHER_CLERK_SUB, 'divya@example.com')

    const rows = await asRole('authenticated', { sub: CLERK_SUB }, (client) =>
      client.query(`select email from customers`).then((r) => r.rows),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].email).toBe('ananya@example.com')
  })

  it('scopes bookings to the signed-in Clerk user', async () => {
    const mine = await createClerkCustomer(CLERK_SUB, 'ananya@example.com')
    const theirs = await createClerkCustomer(OTHER_CLERK_SUB, 'divya@example.com')
    const myBooking = await seedBooking(mine, 30)
    await seedBooking(theirs, 60)

    const rows = await asRole('authenticated', { sub: CLERK_SUB }, (client) =>
      client.query<{ id: string }>(`select id from bookings`).then((r) => r.rows),
    )
    expect(rows.map((r) => r.id)).toEqual([myBooking])
  })

  it('scopes booking_events through the same join', async () => {
    const mine = await createClerkCustomer(CLERK_SUB, 'ananya@example.com')
    const theirs = await createClerkCustomer(OTHER_CLERK_SUB, 'divya@example.com')
    const myBooking = await seedBooking(mine, 30)
    const theirBooking = await seedBooking(theirs, 60)

    for (const id of [myBooking, theirBooking]) {
      await query(
        `insert into booking_events (booking_id, from_status, to_status, actor_type)
         values ($1, null, 'confirmed', 'system')`,
        [id],
      )
    }

    const rows = await asRole('authenticated', { sub: CLERK_SUB }, (client) =>
      client
        .query<{ booking_id: string }>(`select booking_id from booking_events`)
        .then((r) => r.rows),
    )
    expect(rows.map((r) => r.booking_id)).toEqual([myBooking])
  })

  it('shows nothing at all to an anonymous visitor', async () => {
    const mine = await createClerkCustomer(CLERK_SUB, 'ananya@example.com')
    await seedBooking(mine, 30)

    const customers = await asRole('anon', null, (client) =>
      client.query(`select id from customers`).then((r) => r.rows),
    )
    const bookings = await asRole('anon', null, (client) =>
      client.query(`select id from bookings`).then((r) => r.rows),
    )
    expect(customers).toHaveLength(0)
    expect(bookings).toHaveLength(0)
  })
})

describe('ac_ensure_customer', () => {
  it('creates a customer against a Clerk subject', async () => {
    const [{ id }] = await query<{ id: string }>(
      `select ac_ensure_customer($1, $2, $3) as id`,
      [CLERK_SUB, 'Ananya@Example.com', '2026-08-01'],
    )
    expect(id).toBeTruthy()

    const [row] = await query(
      `select auth_user_id, email, consent_version from customers where id = $1`,
      [id],
    )
    expect(row.auth_user_id).toBe(CLERK_SUB)
    // Lower-cased, because customers_email_key is a unique index on lower(email).
    expect(row.email).toBe('ananya@example.com')
    expect(row.consent_version).toBe('2026-08-01')
  })

  it('is idempotent — signing in twice does not create a second customer', async () => {
    const [{ id: first }] = await query<{ id: string }>(
      `select ac_ensure_customer($1, $2, null) as id`,
      [CLERK_SUB, 'ananya@example.com'],
    )
    const [{ id: second }] = await query<{ id: string }>(
      `select ac_ensure_customer($1, $2, null) as id`,
      [CLERK_SUB, 'ananya@example.com'],
    )
    expect(second).toBe(first)

    const [{ count }] = await query<{ count: string }>(
      `select count(*)::text from customers`,
    )
    expect(Number(count)).toBe(1)
  })

  /**
   * The migration path that matters: someone who booked under Supabase Auth
   * comes back through Clerk. Her history has to follow her, not be orphaned.
   */
  it('adopts an existing record with the same email under a new subject', async () => {
    const existing = await createClerkCustomer(
      'legacy-supabase-uuid-subject',
      'ananya@example.com',
    )
    const bookingId = await seedBooking(existing, 30)

    const [{ id }] = await query<{ id: string }>(
      `select ac_ensure_customer($1, $2, null) as id`,
      [CLERK_SUB, 'ananya@example.com'],
    )

    expect(id).toBe(existing)

    const [row] = await query(`select auth_user_id from customers where id = $1`, [id])
    expect(row.auth_user_id).toBe(CLERK_SUB)

    // And the booking is now reachable under the Clerk session.
    const rows = await asRole('authenticated', { sub: CLERK_SUB }, (client) =>
      client.query<{ id: string }>(`select id from bookings`).then((r) => r.rows),
    )
    expect(rows.map((r) => r.id)).toEqual([bookingId])
  })

  it('refuses an empty subject or a missing email', async () => {
    await expect(
      query(`select ac_ensure_customer($1, $2, null)`, ['', 'a@b.com']),
    ).rejects.toThrow(/AC_NOT_AUTHENTICATED/)
    await expect(
      query(`select ac_ensure_customer($1, $2, null)`, [CLERK_SUB, '  ']),
    ).rejects.toThrow(/AC_NO_EMAIL/)
  })

  /**
   * It adopts by email, so a caller who could pass an arbitrary address could
   * attach their own Clerk id to someone else's bookings. Only the server may
   * call it — the grant IS the security boundary here.
   */
  it('is not callable by anon or authenticated', async () => {
    const [row] = await query<{ anon: boolean; auth: boolean }>(`
      select has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'ac_ensure_customer'
    `)
    expect(row.anon).toBe(false)
    expect(row.auth).toBe(false)
  })
})

describe('no auth.uid() remains on the customer path', () => {
  it('leaves no policy or function calling auth.uid()', async () => {
    const policies = await query<{ policyname: string }>(`
      select policyname from pg_policies
       where schemaname = 'public'
         and (qual like '%auth.uid%' or with_check like '%auth.uid%')
    `)
    expect(policies.map((p) => p.policyname)).toEqual([])

    const functions = await query<{ proname: string }>(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosrc like '%auth.uid()%'
    `)
    expect(functions.map((f) => f.proname)).toEqual([])
  })
})
