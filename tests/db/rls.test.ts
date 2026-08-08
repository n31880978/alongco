import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import {
  asRole,
  closePool,
  createArea,
  createCompanion,
  createCustomer,
  createIdentity,
  insertBookingSql,
  query,
  resetData,
} from '../helpers/db'

/**
 * T2 acceptance — RLS is on for every table and denies by default.
 *
 * These assert what the anon and authenticated roles genuinely cannot reach,
 * with real JWT claims set on the connection the way PostgREST sets them.
 * Inspecting the policy text would not have caught a missing `enable row level
 * security`, which is the failure that actually leaks data.
 */

describe('row level security', () => {
  let companionId: string
  let inactiveId: string
  let areaId: string
  let alice: { id: string; authUserId: string }
  let bella: { id: string; authUserId: string }
  let aliceBooking: string
  let bellaBooking: string

  beforeEach(async () => {
    await resetData()
    areaId = await createArea()
    companionId = await createCompanion({ slug: 'noor', areas: [areaId] })
    inactiveId = await createCompanion({ slug: 'hidden', isActive: false, areas: [areaId] })
    await createIdentity(companionId)

    alice = await createCustomer({ phone: '919812345678' })
    bella = await createCustomer({ phone: '919887654321' })

    const mk = async (customerId: string, ref: string, clock: string) => {
      const [{ id }] = await query<{ id: string }>(insertBookingSql(), [
        ref,
        customerId,
        companionId,
        areaId,
        `2027-03-10T${clock}:00+05:30`,
        `2027-03-10T${Number(clock.slice(0, 2)) + 1}:00:00+05:30`,
        15,
        'confirmed',
        49900,
        49900,
        '2026-08-01',
      ])
      return id
    }
    aliceBooking = await mk(alice.id, 'AC-ALICE1', '10:00')
    bellaBooking = await mk(bella.id, 'AC-BELLA1', '14:00')
  })

  afterAll(closePool)

  it('enables RLS on every table in public', async () => {
    const rows = await query<{ tablename: string }>(`
      select c.relname as tablename
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
    `)
    expect(rows.map((r) => r.tablename)).toEqual([])
  })

  describe('as anon', () => {
    it('cannot read companion_identities', async () => {
      const rows = await asRole('anon', null, (c) =>
        c.query('select * from companion_identities').then((r) => r.rows),
      )
      expect(rows).toEqual([])
    })

    it('cannot read payments, refunds or webhook payloads', async () => {
      for (const table of ['payments', 'refunds', 'webhook_events', 'payouts']) {
        const rows = await asRole('anon', null, (c) =>
          c.query(`select * from ${table}`).then((r) => r.rows),
        )
        expect(rows, table).toEqual([])
      }
    })

    it('cannot read any booking', async () => {
      const rows = await asRole('anon', null, (c) =>
        c.query('select * from bookings').then((r) => r.rows),
      )
      expect(rows).toEqual([])
    })

    it('cannot read customers, incidents or the audit log', async () => {
      for (const table of ['customers', 'incidents', 'admin_audit_log', 'admin_users']) {
        const rows = await asRole('anon', null, (c) =>
          c.query(`select * from ${table}`).then((r) => r.rows),
        )
        expect(rows, table).toEqual([])
      }
    })

    it('cannot read blackout reasons', async () => {
      await query(
        `insert into companion_blackouts (companion_id, starts_at, ends_at, reason)
         values ($1, '2027-03-10T09:00:00+05:30', '2027-03-10T11:00:00+05:30', 'personal')`,
        [companionId],
      )
      const rows = await asRole('anon', null, (c) =>
        c.query('select * from companion_blackouts').then((r) => r.rows),
      )
      expect(rows).toEqual([])
    })

    it('sees active companions but not inactive ones', async () => {
      const rows = await asRole('anon', null, (c) =>
        c.query('select slug from companions').then((r) => r.rows),
      )
      expect(rows.map((r: any) => r.slug)).toEqual(['noor'])
      expect(rows.map((r: any) => r.slug)).not.toContain('hidden')
    })

    it('sees only published reviews', async () => {
      await query(
        `insert into reviews (booking_id, customer_id, companion_id, rating, body, is_published)
         values ($1,$2,$3,5,'published one', true), ($4,$5,$6,4,'pending moderation', false)`,
        [aliceBooking, alice.id, companionId, bellaBooking, bella.id, companionId],
      )
      const rows = await asRole('anon', null, (c) =>
        c.query('select body from reviews').then((r) => r.rows),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].body).toBe('published one')
    })

    it('cannot insert a booking directly', async () => {
      await expect(
        asRole('anon', null, (c) =>
          c.query(insertBookingSql(), [
            'AC-FORGE1',
            alice.id,
            companionId,
            areaId,
            '2027-03-11T10:00:00+05:30',
            '2027-03-11T11:00:00+05:30',
            15,
            'confirmed',
            100,
            100,
            '2026-08-01',
          ]),
        ),
      ).rejects.toThrow(/row-level security|permission denied/i)
    })

    it('cannot call create_booking_hold', async () => {
      await expect(
        asRole('anon', null, (c) =>
          c.query(
            `select create_booking_hold('noor', '2027-03-11T10:00:00+05:30', 60, $1, '2026-08-01')`,
            [areaId],
          ),
        ),
      ).rejects.toThrow(/permission denied/i)
    })
  })

  describe('as an authenticated customer', () => {
    const claims = (authUserId: string) => ({ sub: authUserId, role: 'authenticated' })

    it('reads her own bookings and no one else’s', async () => {
      const rows = await asRole('authenticated', claims(alice.authUserId), (c) =>
        c.query('select reference from bookings').then((r) => r.rows),
      )
      expect(rows.map((r: any) => r.reference)).toEqual(['AC-ALICE1'])
    })

    it('cannot read another customer’s booking by id', async () => {
      const rows = await asRole('authenticated', claims(alice.authUserId), (c) =>
        c.query('select reference from bookings where id = $1', [bellaBooking]).then((r) => r.rows),
      )
      expect(rows).toEqual([])
    })

    it('reads only her own customer row', async () => {
      const rows = await asRole('authenticated', claims(alice.authUserId), (c) =>
        c.query('select phone from customers').then((r) => r.rows),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].phone).toBe('919812345678')
    })

    it('still cannot read companion_identities', async () => {
      const rows = await asRole('authenticated', claims(alice.authUserId), (c) =>
        c.query('select * from companion_identities').then((r) => r.rows),
      )
      expect(rows).toEqual([])
    })

    it('cannot unblock herself — there is no update policy on customers', async () => {
      await query(`update customers set is_blocked = true where id = $1`, [alice.id])
      const res = await asRole('authenticated', claims(alice.authUserId), (c) =>
        c.query('update customers set is_blocked = false where id = $1', [alice.id]),
      )
      expect(res.rowCount).toBe(0)

      const [row] = await query<{ is_blocked: boolean }>(
        `select is_blocked from customers where id = $1`,
        [alice.id],
      )
      expect(row.is_blocked).toBe(true)
    })

    it('cannot change her booking’s status or amount', async () => {
      const res = await asRole('authenticated', claims(alice.authUserId), (c) =>
        c.query(`update bookings set amount_paise = 100 where id = $1`, [aliceBooking]),
      )
      expect(res.rowCount).toBe(0)
    })

    it('cannot review a booking that is not completed', async () => {
      await expect(
        asRole('authenticated', claims(alice.authUserId), (c) =>
          c.query(
            `insert into reviews (booking_id, customer_id, companion_id, rating, body)
             values ($1,$2,$3,5,'lovely')`,
            [aliceBooking, alice.id, companionId],
          ),
        ),
      ).rejects.toThrow(/row-level security/i)
    })

    it('cannot review someone else’s completed booking', async () => {
      await query(
        `update bookings set status = 'completed', ends_at = now() - interval '1 hour',
                             starts_at = now() - interval '2 hours' where id = $1`,
        [bellaBooking],
      )
      await expect(
        asRole('authenticated', claims(alice.authUserId), (c) =>
          c.query(
            `insert into reviews (booking_id, customer_id, companion_id, rating, body)
             values ($1,$2,$3,5,'not mine')`,
            [bellaBooking, alice.id, companionId],
          ),
        ),
      ).rejects.toThrow(/row-level security/i)
    })

    it('can review her own completed booking, unpublished', async () => {
      await query(
        `update bookings set status = 'completed', ends_at = now() - interval '1 hour',
                             starts_at = now() - interval '2 hours' where id = $1`,
        [aliceBooking],
      )
      const res = await asRole('authenticated', claims(alice.authUserId), (c) =>
        c.query(
          `insert into reviews (booking_id, customer_id, companion_id, rating, body)
           values ($1,$2,$3,5,'turned up on time') returning id`,
          [aliceBooking, alice.id, companionId],
        ),
      )
      expect(res.rowCount).toBe(1)
    })

    it('cannot self-publish a review', async () => {
      await query(
        `update bookings set status = 'completed', ends_at = now() - interval '1 hour',
                             starts_at = now() - interval '2 hours' where id = $1`,
        [aliceBooking],
      )
      await expect(
        asRole('authenticated', claims(alice.authUserId), (c) =>
          c.query(
            `insert into reviews (booking_id, customer_id, companion_id, rating, body, is_published)
             values ($1,$2,$3,5,'please show me', true)`,
            [aliceBooking, alice.id, companionId],
          ),
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })

  describe('get_availability_inputs', () => {
    it('returns bare windows with no reason, customer or reference', async () => {
      await query(
        `insert into companion_blackouts (companion_id, starts_at, ends_at, reason)
         values ($1, '2027-03-10T09:00:00+05:30', '2027-03-10T11:00:00+05:30', 'personal matter')`,
        [companionId],
      )

      const rows = await asRole('anon', null, (c) =>
        c
          .query(
            `select get_availability_inputs($1, '2027-03-01T00:00:00Z', '2027-03-20T00:00:00Z') as d`,
            [companionId],
          )
          .then((r) => r.rows),
      )

      const payload = JSON.stringify(rows[0].d)
      expect(payload).not.toContain('personal matter')
      expect(payload).not.toContain('AC-ALICE1')
      expect(payload).not.toContain(alice.id)
      expect(rows[0].d.busy).toHaveLength(2)
      expect(rows[0].d.blackouts).toHaveLength(1)
      expect(Object.keys(rows[0].d.busy[0]).sort()).toEqual(['ends_at', 'starts_at'])
    })

    it('returns null for an inactive companion', async () => {
      const rows = await asRole('anon', null, (c) =>
        c
          .query(
            `select get_availability_inputs($1, '2027-03-01T00:00:00Z', '2027-03-20T00:00:00Z') as d`,
            [inactiveId],
          )
          .then((r) => r.rows),
      )
      expect(rows[0].d).toBeNull()
    })

    it('omits expired holds so the slot is offerable again', async () => {
      await query(
        `update bookings set status = 'pending_payment',
                             hold_expires_at = now() - interval '1 minute'
           where id = $1`,
        [aliceBooking],
      )
      const rows = await asRole('anon', null, (c) =>
        c
          .query(
            `select get_availability_inputs($1, '2027-03-01T00:00:00Z', '2027-03-20T00:00:00Z') as d`,
            [companionId],
          )
          .then((r) => r.rows),
      )
      expect(rows[0].d.busy).toHaveLength(1)
    })
  })
})
