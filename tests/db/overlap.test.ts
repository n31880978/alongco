import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import {
  closePool,
  createArea,
  createCompanion,
  createCustomer,
  getPool,
  insertBookingSql,
  query,
  resetData,
} from '../helpers/db'

/**
 * T3 — the double-booking guard. CLAUDE.md §3.5 and PRD §6.4.
 *
 * Everything here goes through a real Postgres. The whole point of the
 * exclusion constraint is that it holds when two transactions race, which no
 * mock and no read-then-write check can demonstrate.
 */

const IST_OFFSET = '+05:30'

/** A fixed future weekday afternoon in IST, so no test depends on today. */
function ist(day: string, clock: string): string {
  return `${day}T${clock}:00${IST_OFFSET}`
}

const DAY = '2027-03-10' // a Wednesday

describe('bookings_no_overlap', () => {
  let companionId: string
  let areaId: string
  let customerA: string
  let customerB: string

  beforeAll(async () => {
    areaId = await createArea()
  })

  beforeEach(async () => {
    await resetData()
    areaId = await createArea()
    companionId = await createCompanion({ areas: [areaId] })
    customerA = (await createCustomer()).id
    customerB = (await createCustomer()).id
  })

  afterAll(closePool)

  async function book(
    customerId: string,
    startClock: string,
    endClock: string,
    status = 'pending_payment',
  ) {
    return query(insertBookingSql(), [
      `AC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      customerId,
      companionId,
      areaId,
      ist(DAY, startClock),
      ist(DAY, endClock),
      15,
      status,
      49900,
      49900,
      '2026-08-01',
    ])
  }

  it('rejects a second booking overlapping the first', async () => {
    await book(customerA, '14:00', '15:00')
    await expect(book(customerB, '14:30', '15:30')).rejects.toThrow(
      /bookings_no_overlap|exclusion/i,
    )
  })

  it('rejects a start inside the trailing buffer — 15:00 end blocks 15:10', async () => {
    await book(customerA, '14:00', '15:00')
    await expect(book(customerB, '15:10', '16:10')).rejects.toThrow(
      /bookings_no_overlap|exclusion/i,
    )
  })

  it('accepts a start exactly at the buffer boundary — 15:15', async () => {
    await book(customerA, '14:00', '15:00')
    const rows = await book(customerB, '15:15', '16:15')
    expect(rows).toHaveLength(1)
  })

  it('accepts a booking ending exactly when the next reserved period starts', async () => {
    await book(customerA, '16:00', '17:00') // reserved 16:00–17:15
    // Ends 15:45, +15 buffer = 16:00. Half-open ranges do not collide.
    const rows = await book(customerB, '14:45', '15:45')
    expect(rows).toHaveLength(1)
  })

  it('frees the slot when the first booking is cancelled', async () => {
    const [{ id }] = await book(customerA, '14:00', '15:00')
    await query(`update bookings set status = 'cancelled_by_customer' where id = $1`, [id])
    const rows = await book(customerB, '14:00', '15:00')
    expect(rows).toHaveLength(1)
  })

  it('frees the slot when a hold expires', async () => {
    const [{ id }] = await book(customerA, '14:00', '15:00')
    await query(`update bookings set status = 'expired' where id = $1`, [id])
    const rows = await book(customerB, '14:00', '15:00')
    expect(rows).toHaveLength(1)
  })

  it('keeps the slot blocked for a booking ended early for conduct', async () => {
    await book(customerA, '14:00', '15:00', 'ended_early')
    await expect(book(customerB, '14:00', '15:00')).rejects.toThrow(
      /bookings_no_overlap|exclusion/i,
    )
  })

  it('allows the same window for a different companion', async () => {
    const other = await createCompanion({ areas: [areaId] })
    await book(customerA, '14:00', '15:00')
    const rows = await query(insertBookingSql(), [
      'AC-OTHER1',
      customerB,
      other,
      areaId,
      ist(DAY, '14:00'),
      ist(DAY, '15:00'),
      15,
      'pending_payment',
      49900,
      49900,
      '2026-08-01',
    ])
    expect(rows).toHaveLength(1)
  })

  it('recomputes reserved_period on update, so it cannot be forced out of sync', async () => {
    const [{ id }] = await book(customerA, '14:00', '15:00')
    // Try to widen the reserved period by hand; the trigger overwrites it.
    await query(
      `update bookings set reserved_period = tstzrange($2, $3, '[)') where id = $1`,
      [id, ist(DAY, '00:00'), ist(DAY, '23:59')],
    )
    const [row] = await query<{ lower: Date; upper: Date }>(
      `select lower(reserved_period) as lower, upper(reserved_period) as upper
         from bookings where id = $1`,
      [id],
    )
    expect(new Date(row.lower).toISOString()).toBe(new Date(ist(DAY, '14:00')).toISOString())
    expect(new Date(row.upper).toISOString()).toBe(new Date(ist(DAY, '15:15')).toISOString())
  })

  describe('under concurrency', () => {
    it('lets exactly one of two simultaneous inserts win', async () => {
      const pool = getPool()
      const a = await pool.connect()
      const b = await pool.connect()

      try {
        await a.query('begin')
        await b.query('begin')

        const params = (customerId: string, ref: string) => [
          ref,
          customerId,
          companionId,
          areaId,
          ist(DAY, '18:00'),
          ist(DAY, '19:00'),
          15,
          'pending_payment',
          49900,
          49900,
          '2026-08-01',
        ]

        // Both statements are in flight before either commits. The exclusion
        // constraint makes the second block until the first resolves, then fail.
        const first = a.query(insertBookingSql(), params(customerA, 'AC-RACE01'))
        const second = b.query(insertBookingSql(), params(customerB, 'AC-RACE02'))

        const settled = await Promise.allSettled([
          first.then(async () => {
            await a.query('commit')
            return 'a'
          }),
          second.then(async () => {
            await b.query('commit')
            return 'b'
          }),
        ])

        const fulfilled = settled.filter((s) => s.status === 'fulfilled')
        const rejected = settled.filter((s) => s.status === 'rejected')

        expect(fulfilled).toHaveLength(1)
        expect(rejected).toHaveLength(1)

        const rows = await query(
          `select id from bookings where companion_id = $1 and starts_at = $2`,
          [companionId, ist(DAY, '18:00')],
        )
        expect(rows).toHaveLength(1)
      } finally {
        await a.query('rollback').catch(() => {})
        await b.query('rollback').catch(() => {})
        a.release()
        b.release()
      }
    })

    it('lets exactly one of ten simultaneous inserts win', async () => {
      const pool = getPool()
      const clients = await Promise.all(
        Array.from({ length: 10 }, () => pool.connect()),
      )

      let settled: PromiseSettledResult<number>[]
      try {
        const attempts = clients.map(async (client, i) => {
          await client.query('begin')
          await client.query(insertBookingSql(), [
            `AC-BULK${String(i).padStart(2, '0')}`,
            i % 2 === 0 ? customerA : customerB,
            companionId,
            areaId,
            ist(DAY, '20:00'),
            ist(DAY, '21:00'),
            15,
            'pending_payment',
            49900,
            49900,
            '2026-08-01',
          ])
          await client.query('commit')
          return i
        })

        settled = await Promise.allSettled(attempts)
      } finally {
        await Promise.all(
          clients.map(async (c) => {
            await c.query('rollback').catch(() => {})
            c.release()
          }),
        )
      }

      expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1)

      const rows = await query(
        `select id from bookings where companion_id = $1 and starts_at = $2`,
        [companionId, ist(DAY, '20:00')],
      )
      expect(rows).toHaveLength(1)
    })
  })
})
