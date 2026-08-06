import { Pool, type PoolClient } from 'pg'

/**
 * Test database access.
 *
 * These tests run against a real Postgres with the real migrations applied
 * (`npm run db:reset`). The overlap constraint, the exclusion semantics and the
 * RLS policies are the things being tested — a mock would test nothing.
 */

const LOCAL_TEST_DB = process.env.ALONGCO_TEST_DB ?? 'alongco_test'

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  `postgres://${process.env.USER ?? 'postgres'}@localhost:5432/${LOCAL_TEST_DB}`

/**
 * These tests TRUNCATE every mutable table, so the one thing that must never
 * happen is running them against a real database.
 *
 * The guard is on the database name rather than on the presence of an env var:
 * requiring TEST_DATABASE_URL blocked the local Postgres path entirely without
 * actually preventing anyone from pointing that variable at production. A name
 * that has to contain "test" catches the accident this is guarding against and
 * still lets `npm run db:reset && npm test` work with no configuration.
 */
{
  const name = decodeURIComponent(
    new URL(TEST_DATABASE_URL).pathname.replace(/^\//, ''),
  )
  if (!/test/i.test(name)) {
    throw new Error(
      `Refusing to run destructive database tests against "${name}". ` +
        'The database name must contain "test" — these suites truncate every mutable table. ' +
        'Set TEST_DATABASE_URL to a dedicated test database, or run `npm run db:reset` to build the local one.',
    )
  }
}

let pool: Pool | undefined

export function getPool(): Pool {
  // Headroom above the widest concurrency test, so verification queries never
  // queue behind connections that test is still holding.
  if (!pool) pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 24 })
  return pool
}

export async function closePool() {
  if (pool) {
    await pool.end()
    pool = undefined
  }
}

export async function query<T = any>(sql: string, params: any[] = []) {
  const res = await getPool().query(sql, params)
  return res.rows as T[]
}

/** Wipes every mutable table. Settings and areas are seed data and survive. */
export async function resetData() {
  await query(`
    truncate table
      booking_events, refunds, payments, webhook_events, reviews, incidents,
      support_messages, support_tickets, payouts, bookings,
      companion_areas, companion_availability, companion_blackouts,
      companion_identities, companions, customers,
      admin_audit_log, admin_users, otp_requests
    restart identity cascade;
  `)
}

/**
 * Runs `fn` as a Supabase role with a JWT claim set, exactly as PostgREST does.
 * This is what makes the RLS assertions meaningful rather than decorative.
 */
export async function asRole<T>(
  role: 'anon' | 'authenticated' | 'service_role',
  claims: Record<string, unknown> | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('begin')
    const payload = JSON.stringify({ role, ...(claims ?? {}) })
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [payload])
    await client.query(`set local role ${role}`)
    const out = await fn(client)
    await client.query('commit')
    return out
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// --- fixtures ---------------------------------------------------------------

export async function createArea(name = 'MG Road'): Promise<string> {
  const rows = await query<{ id: string }>(
    `select id from areas where name = $1`,
    [name],
  )
  return rows[0].id
}

export async function createCompanion(
  opts: {
    slug?: string
    displayName?: string
    hourlyRatePaise?: number
    isActive?: boolean
    isAccepting?: boolean
    areas?: string[]
    /** Weekly rules; defaults to 08:00–22:00 every day. */
    rules?: { weekday: number; start: string; end: string }[]
  } = {},
): Promise<string> {
  const {
    slug = `companion-${Math.random().toString(36).slice(2, 8)}`,
    displayName = 'Test Companion',
    hourlyRatePaise = 49900,
    isActive = true,
    isAccepting = true,
    areas,
    rules,
  } = opts

  const [{ id }] = await query<{ id: string }>(
    `insert into companions (slug, display_name, hourly_rate_paise, is_active, is_accepting)
     values ($1,$2,$3,$4,$5) returning id`,
    [slug, displayName, hourlyRatePaise, isActive, isAccepting],
  )

  const areaIds = areas ?? [await createArea()]
  for (const areaId of areaIds) {
    await query(
      `insert into companion_areas (companion_id, area_id) values ($1,$2)
       on conflict do nothing`,
      [id, areaId],
    )
  }

  const weekly =
    rules ??
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      start: '08:00',
      end: '22:00',
    }))
  for (const r of weekly) {
    await query(
      `insert into companion_availability (companion_id, weekday, start_time, end_time)
       values ($1,$2,$3,$4)`,
      [id, r.weekday, r.start, r.end],
    )
  }

  return id
}

export async function createIdentity(companionId: string) {
  await query(
    `insert into companion_identities (companion_id, legal_name, phone, vetting_notes)
     values ($1,$2,$3,$4)`,
    [companionId, 'Real Name Here', '919900000000', 'internal vetting note'],
  )
}

export async function createCustomer(
  opts: { phone?: string; authUserId?: string; blocked?: boolean } = {},
): Promise<{ id: string; authUserId: string }> {
  const authUserId = opts.authUserId ?? randomUuid()
  const phone = opts.phone ?? `9199${Math.floor(10_000_000 + Math.random() * 89_999_999)}`
  const [{ id }] = await query<{ id: string }>(
    `insert into customers (auth_user_id, phone, full_name, is_blocked)
     values ($1,$2,$3,$4) returning id`,
    [authUserId, phone, 'Test Customer', opts.blocked ?? false],
  )
  return { id, authUserId }
}

export function randomUuid(): string {
  return crypto.randomUUID()
}

/** Terms version the RPC will accept, read from settings rather than assumed. */
export async function currentTermsVersion(): Promise<string> {
  const [{ v }] = await query<{ v: string }>(
    `select value #>> '{}' as v from settings where key = 'terms_version'`,
  )
  return v
}

/**
 * Inserts a booking directly, bypassing the RPC. Used by the constraint tests,
 * which are about the database refusing overlaps regardless of how a row is
 * attempted.
 */
export function insertBookingSql() {
  return `
    insert into bookings (
      reference, customer_id, companion_id, area_id,
      starts_at, ends_at, buffer_minutes, status,
      amount_paise, rate_snapshot_paise, terms_version, terms_accepted_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
    returning id`
}
