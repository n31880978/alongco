import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import {
  asRole,
  closePool,
  createArea,
  createCompanion,
  createCustomer,
  currentTermsVersion,
  query,
  resetData,
} from '../helpers/db'
import { fromZoned, zonedParts } from '@/lib/time/zone'

/**
 * T9 — create_booking_hold is the only door into the bookings table.
 *
 * PRD §6.4: the client never supplies an amount, the price is snapshotted, the
 * hold has a TTL, and a race produces exactly one hold.
 */

/** A slot `days` ahead at the given IST wall-clock hour. */
function slotAt(days: number, hour: number, minute = 0): string {
  const p = zonedParts(new Date())
  return fromZoned(p.year, p.month, p.day + days, hour, minute).toISOString()
}

describe('create_booking_hold', () => {
  let companionId: string
  let areaId: string
  let otherAreaId: string
  let alice: { id: string; authUserId: string }
  let bella: { id: string; authUserId: string }
  let terms: string

  const claims = (authUserId: string) => ({ sub: authUserId, role: 'authenticated' })

  const hold = (
    who: { authUserId: string },
    args: {
      slug?: string
      startsAt: string
      minutes?: number
      areaId?: string
      terms?: string
      notes?: string | null
    },
  ) =>
    asRole('authenticated', claims(who.authUserId), (c) =>
      c
        .query(`select create_booking_hold($1,$2,$3,$4,$5,$6) as r`, [
          args.slug ?? 'noor',
          args.startsAt,
          args.minutes ?? 60,
          args.areaId ?? areaId,
          args.terms ?? terms,
          args.notes ?? null,
        ])
        .then((r) => r.rows[0].r as Record<string, any>),
    )

  beforeEach(async () => {
    await resetData()
    terms = await currentTermsVersion()
    areaId = await createArea('MG Road')
    otherAreaId = await createArea('Indiranagar')
    companionId = await createCompanion({ slug: 'noor', areas: [areaId] })
    alice = await createCustomer()
    bella = await createCustomer()
  })

  afterAll(closePool)

  it('creates a hold with a server-computed price and a TTL', async () => {
    const r = await hold(alice, { startsAt: slotAt(1, 14) })

    expect(r.resumed).toBe(false)
    expect(r.reference).toMatch(/^AC-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/)
    expect(r.amount_paise).toBe(49900)

    const [row] = await query<any>(`select * from bookings where id = $1`, [r.booking_id])
    expect(row.status).toBe('pending_payment')
    expect(row.amount_paise).toBe(49900)
    expect(row.rate_snapshot_paise).toBe(49900)
    expect(row.buffer_minutes).toBe(15)
    expect(row.terms_version).toBe(terms)
    expect(row.terms_accepted_at).not.toBeNull()

    const ttl = new Date(row.hold_expires_at).getTime() - Date.now()
    expect(ttl).toBeGreaterThan(9 * 60_000)
    expect(ttl).toBeLessThanOrEqual(10 * 60_000 + 5_000)
  })

  it('writes a booking_events row on creation', async () => {
    const r = await hold(alice, { startsAt: slotAt(1, 14) })
    const events = await query<any>(
      `select to_status, actor_type from booking_events where booking_id = $1`,
      [r.booking_id],
    )
    expect(events).toEqual([{ to_status: 'pending_payment', actor_type: 'customer' }])
  })

  it('applies the duration discounts from settings', async () => {
    const one = await hold(alice, { startsAt: slotAt(1, 9), minutes: 60 })
    const two = await hold(alice, { startsAt: slotAt(2, 9), minutes: 120 })
    const three = await hold(alice, { startsAt: slotAt(3, 9), minutes: 180 })

    expect(one.amount_paise).toBe(49900) // ₹499
    expect(two.amount_paise).toBe(89800) // ₹898, −10%
    expect(three.amount_paise).toBe(104800) // ₹1,048, −30%
  })

  it('ignores a rate change after the hold — the snapshot is charged', async () => {
    const r = await hold(alice, { startsAt: slotAt(1, 14) })
    await query(`update companions set hourly_rate_paise = 99900 where id = $1`, [companionId])

    const [row] = await query<any>(`select amount_paise, rate_snapshot_paise from bookings where id = $1`, [
      r.booking_id,
    ])
    expect(row.amount_paise).toBe(49900)
    expect(row.rate_snapshot_paise).toBe(49900)
  })

  it('resumes an existing live hold instead of creating a second booking', async () => {
    const first = await hold(alice, { startsAt: slotAt(1, 14) })
    const second = await hold(alice, { startsAt: slotAt(1, 14) })

    expect(second.resumed).toBe(true)
    expect(second.booking_id).toBe(first.booking_id)

    const rows = await query(`select id from bookings where customer_id = $1`, [alice.id])
    expect(rows).toHaveLength(1)
  })

  it('refuses a slot another customer already holds', async () => {
    await hold(alice, { startsAt: slotAt(1, 14) })
    await expect(hold(bella, { startsAt: slotAt(1, 14) })).rejects.toThrow(/AC_SLOT_TAKEN/)
  })

  it('refuses a start inside another booking’s trailing buffer', async () => {
    await hold(alice, { startsAt: slotAt(1, 14) }) // 14:00–15:00, reserved to 15:15
    await expect(hold(bella, { startsAt: slotAt(1, 15, 10) })).rejects.toThrow(/AC_SLOT_TAKEN/)
  })

  it('allows a start exactly at the buffer boundary', async () => {
    await hold(alice, { startsAt: slotAt(1, 14) })
    const r = await hold(bella, { startsAt: slotAt(1, 15, 15) })
    expect(r.resumed).toBe(false)
  })

  it('lets exactly one of two racing holds win', async () => {
    const startsAt = slotAt(1, 18)
    const results = await Promise.allSettled([
      hold(alice, { startsAt }),
      hold(bella, { startsAt }),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(String(rejected.reason)).toMatch(/AC_SLOT_TAKEN/)

    const rows = await query(`select id from bookings where starts_at = $1`, [startsAt])
    expect(rows).toHaveLength(1)
  })

  it('frees the slot once a hold expires', async () => {
    const r = await hold(alice, { startsAt: slotAt(1, 14) })
    await query(`update bookings set hold_expires_at = now() - interval '1 minute' where id = $1`, [
      r.booking_id,
    ])
    await query(`select ac_expire_holds()`)

    const second = await hold(bella, { startsAt: slotAt(1, 14) })
    expect(second.resumed).toBe(false)
  })

  it('refuses a blocked customer with no slot held', async () => {
    await query(`update customers set is_blocked = true where id = $1`, [alice.id])
    await expect(hold(alice, { startsAt: slotAt(1, 14) })).rejects.toThrow(/AC_BOOKING_REFUSED/)

    const rows = await query(`select id from bookings`)
    expect(rows).toEqual([])
  })

  it('refuses a stale terms version', async () => {
    await expect(hold(alice, { startsAt: slotAt(1, 14), terms: '2020-01-01' })).rejects.toThrow(
      /AC_TERMS_STALE/,
    )
  })

  it('refuses a duration under the settings minimum', async () => {
    await expect(hold(alice, { startsAt: slotAt(1, 14), minutes: 30 })).rejects.toThrow(
      /AC_DURATION_TOO_SHORT/,
    )
  })

  it('refuses a slot in the past', async () => {
    await expect(hold(alice, { startsAt: slotAt(-1, 14) })).rejects.toThrow(/AC_SLOT_IN_PAST/)
  })

  it('refuses a slot beyond the booking window', async () => {
    await expect(hold(alice, { startsAt: slotAt(9, 14) })).rejects.toThrow(/AC_OUTSIDE_WINDOW/)
  })

  it('refuses a booking that would end after 22:00', async () => {
    await expect(hold(alice, { startsAt: slotAt(1, 21, 30) })).rejects.toThrow(
      /AC_OUTSIDE_SERVICE_HOURS/,
    )
  })

  it('refuses a booking starting before 08:00', async () => {
    await expect(hold(alice, { startsAt: slotAt(1, 7) })).rejects.toThrow(
      /AC_OUTSIDE_SERVICE_HOURS/,
    )
  })

  it('refuses an area the companion does not serve', async () => {
    await expect(hold(alice, { startsAt: slotAt(1, 14), areaId: otherAreaId })).rejects.toThrow(
      /AC_AREA_UNAVAILABLE/,
    )
  })

  it('refuses a weekday the companion does not work', async () => {
    const target = slotAt(1, 14)
    const weekday = zonedParts(new Date(target)).weekday
    await query(`delete from companion_availability where companion_id = $1 and weekday = $2`, [
      companionId,
      weekday,
    ])
    await expect(hold(alice, { startsAt: target })).rejects.toThrow(/AC_NOT_WORKING/)
  })

  it('refuses a slot inside a blackout', async () => {
    const start = slotAt(1, 14)
    await query(
      `insert into companion_blackouts (companion_id, starts_at, ends_at, reason)
       values ($1, $2::timestamptz - interval '1 hour', $2::timestamptz + interval '2 hours', 'leave')`,
      [companionId, start],
    )
    await expect(hold(alice, { startsAt: start })).rejects.toThrow(/AC_SLOT_TAKEN/)
  })

  it('refuses a paused companion', async () => {
    await query(`update companions set is_accepting = false where id = $1`, [companionId])
    await expect(hold(alice, { startsAt: slotAt(1, 14) })).rejects.toThrow(/AC_COMPANION_PAUSED/)
  })

  it('refuses an inactive companion', async () => {
    await query(`update companions set is_active = false where id = $1`, [companionId])
    await expect(hold(alice, { startsAt: slotAt(1, 14) })).rejects.toThrow(
      /AC_COMPANION_UNAVAILABLE/,
    )
  })

  it('caps concurrent holds per customer', async () => {
    await hold(alice, { startsAt: slotAt(1, 9) })
    await hold(alice, { startsAt: slotAt(2, 9) })
    await hold(alice, { startsAt: slotAt(3, 9) })
    await expect(hold(alice, { startsAt: slotAt(4, 9) })).rejects.toThrow(/AC_TOO_MANY_HOLDS/)
  })

  it('refuses an unauthenticated caller', async () => {
    await expect(
      asRole('authenticated', { sub: '00000000-0000-0000-0000-000000000000', role: 'authenticated' }, (c) =>
        c.query(`select create_booking_hold('noor', $1, 60, $2, $3)`, [slotAt(1, 14), areaId, terms]),
      ),
    ).rejects.toThrow(/AC_NOT_AUTHENTICATED/)
  })

  it('never produces a booking without terms recorded', async () => {
    await hold(alice, { startsAt: slotAt(1, 14) })
    const rows = await query(
      `select id from bookings where terms_version is null or terms_accepted_at is null`,
    )
    expect(rows).toEqual([])
  })
})
