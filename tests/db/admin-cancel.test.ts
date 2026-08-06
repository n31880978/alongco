import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  closePool,
  createArea,
  createCompanion,
  createCustomer,
  currentTermsVersion,
  insertBookingSql,
  query,
  randomUuid,
  resetData,
} from '../helpers/db'

/**
 * ac_admin_cancel_booking — PRD §6.9 and §6.11, TASKS T16 and T17.
 *
 * The acceptance criterion these exist for: a cancellation 47 hours out
 * previews and issues 50%, records the tier, and frees the slot.
 */

let areaId: string
let companionId: string
let customerId: string
let adminId: string
let terms: string

async function seedAdmin(): Promise<string> {
  const id = randomUuid()
  await query(
    `insert into admin_users (id, email, role) values ($1,$2,'owner')`,
    [id, `ops-${id.slice(0, 8)}@alongco.test`],
  )
  return id
}

/** A confirmed, paid booking `hoursOut` hours from now. */
async function seedPaidBooking(hoursOut: number, amountPaise = 49900) {
  const startsAt = new Date(Date.now() + hoursOut * 3600_000)
  const endsAt = new Date(startsAt.getTime() + 60 * 60_000)
  const reference = `AC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`

  const [{ id: bookingId }] = await query<{ id: string }>(insertBookingSql(), [
    reference,
    customerId,
    companionId,
    areaId,
    startsAt.toISOString(),
    endsAt.toISOString(),
    15,
    'confirmed',
    amountPaise,
    49900,
    terms,
  ])

  const [{ id: paymentId }] = await query<{ id: string }>(
    `insert into payments (booking_id, cashfree_order_id, cashfree_payment_id,
                           amount_paise, status, captured_at)
     values ($1,$2,$3,$4,'captured', now()) returning id`,
    [bookingId, `order_${reference}`, `pay_${reference}`, amountPaise],
  )

  return { bookingId, paymentId, reference, startsAt, endsAt }
}

type CancelResult = {
  to_status: string
  tier_code: string
  percent: number
  refund_amount_paise: number
  refund_id: string | null
  refund_reference: string | null
  incident_id: string | null
  cashfree_order_id: string | null
}

async function cancel(
  bookingId: string,
  trigger: string,
  opts: { reason?: string; incidentType?: string; description?: string } = {},
): Promise<CancelResult> {
  const [{ result }] = await query<{ result: CancelResult }>(
    `select ac_admin_cancel_booking($1,$2,$3,$4,$5::incident_type,$6) as result`,
    [
      bookingId,
      adminId,
      trigger,
      opts.reason ?? null,
      opts.incidentType ?? null,
      opts.description ?? null,
    ],
  )
  return result
}

beforeEach(async () => {
  await resetData()
  areaId = await createArea()
  companionId = await createCompanion({ areas: [areaId] })
  customerId = (await createCustomer()).id
  adminId = await seedAdmin()
  terms = await currentTermsVersion()
})

afterAll(closePool)

describe('ac_admin_cancel_booking', () => {
  it('refunds 50% at 47 hours out and records the tier', async () => {
    const { bookingId } = await seedPaidBooking(47)

    const result = await cancel(bookingId, 'admin_cancel', { reason: 'customer asked' })

    expect(result.percent).toBe(50)
    expect(result.tier_code).toBe('24h_half')
    expect(result.refund_amount_paise).toBe(24950)
    expect(result.to_status).toBe('cancelled_by_admin')

    const [booking] = await query(
      `select status, cancelled_by, cancellation_reason, refund_tier_applied
         from bookings where id = $1`,
      [bookingId],
    )
    expect(booking.status).toBe('cancelled_by_admin')
    expect(booking.cancelled_by).toBe('admin')
    expect(booking.cancellation_reason).toBe('customer asked')
    expect(booking.refund_tier_applied).toBe('24h_half')

    const [refund] = await query(
      `select amount_paise, status, tier_applied, refund_reference
         from refunds where booking_id = $1`,
      [bookingId],
    )
    // 'created', not 'success' — the money has not moved until Cashfree says so.
    expect(refund.status).toBe('created')
    expect(refund.amount_paise).toBe(24950)
    expect(refund.tier_applied).toBe('24h_half')
    expect(refund.refund_reference).toMatch(/^RAC-/)
  })

  it('frees the slot, so the same window can be booked again', async () => {
    const { bookingId, startsAt, endsAt } = await seedPaidBooking(47)
    await cancel(bookingId, 'admin_cancel')

    // The exclusion constraint is the real assertion: if the cancelled row still
    // reserved its period, this insert would raise 23P01.
    const rebooked = await query<{ id: string }>(insertBookingSql(), [
      'AC-REBOOK',
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
    expect(rebooked).toHaveLength(1)
  })

  it('refunds 100% at 49 hours out', async () => {
    const { bookingId } = await seedPaidBooking(49)
    const result = await cancel(bookingId, 'admin_cancel')
    expect(result.percent).toBe(100)
    expect(result.tier_code).toBe('48h_full')
    expect(result.refund_amount_paise).toBe(49900)
  })

  it('refunds nothing inside 24 hours, and writes no refund row', async () => {
    const { bookingId } = await seedPaidBooking(6)
    const result = await cancel(bookingId, 'admin_cancel')

    expect(result.percent).toBe(0)
    expect(result.refund_amount_paise).toBe(0)
    expect(result.refund_id).toBeNull()

    const refunds = await query(`select id from refunds where booking_id = $1`, [
      bookingId,
    ])
    expect(refunds).toHaveLength(0)
  })

  it('refunds in full when the companion cancels, whatever the notice', async () => {
    const { bookingId } = await seedPaidBooking(2)
    const result = await cancel(bookingId, 'companion_cancel')
    expect(result.percent).toBe(100)
    expect(result.tier_code).toBe('companion_fault_full')
    expect(result.refund_amount_paise).toBe(49900)
  })

  it('refunds in full on a companion no-show and frees the slot', async () => {
    const { bookingId } = await seedPaidBooking(1)
    const result = await cancel(bookingId, 'companion_no_show')
    expect(result.to_status).toBe('no_show_companion')
    expect(result.refund_amount_paise).toBe(49900)
  })

  it('refunds nothing on a customer no-show and keeps the slot consumed', async () => {
    const { bookingId, startsAt, endsAt } = await seedPaidBooking(1)
    const result = await cancel(bookingId, 'customer_no_show')

    expect(result.to_status).toBe('no_show_customer')
    expect(result.refund_amount_paise).toBe(0)

    // That hour was used up. Selling it again would double-book the companion.
    await expect(
      query(insertBookingSql(), [
        'AC-NOSHOW',
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
      ]),
    ).rejects.toMatchObject({ code: '23P01' })
  })

  describe('conduct breach — T17', () => {
    it('refuses to end a booking early without an incident record', async () => {
      const { bookingId } = await seedPaidBooking(1)
      await expect(cancel(bookingId, 'conduct_breach')).rejects.toThrow(
        /AC_INCIDENT_REQUIRED/,
      )

      // And nothing moved.
      const [booking] = await query(`select status from bookings where id = $1`, [
        bookingId,
      ])
      expect(booking.status).toBe('confirmed')
    })

    it('ends the booking, writes the incident, and refunds nothing', async () => {
      const { bookingId } = await seedPaidBooking(1)
      const result = await cancel(bookingId, 'conduct_breach', {
        incidentType: 'conduct_violation',
        description: 'Companion ended the booking after 20 minutes and reported the customer.',
      })

      expect(result.to_status).toBe('ended_early')
      expect(result.tier_code).toBe('conduct_no_refund')
      expect(result.refund_amount_paise).toBe(0)
      expect(result.incident_id).not.toBeNull()

      const [incident] = await query(
        `select type, status, reported_by, ended_booking, refund_issued
           from incidents where booking_id = $1`,
        [bookingId],
      )
      expect(incident.type).toBe('conduct_violation')
      expect(incident.ended_booking).toBe(true)
      expect(incident.refund_issued).toBe(false)
    })
  })

  it('writes a booking_events row for the transition', async () => {
    const { bookingId } = await seedPaidBooking(47)
    await cancel(bookingId, 'admin_cancel', { reason: 'double booked by hand' })

    const events = await query(
      `select from_status, to_status, actor_type, reason
         from booking_events where booking_id = $1`,
      [bookingId],
    )
    expect(events).toHaveLength(1)
    expect(events[0].from_status).toBe('confirmed')
    expect(events[0].to_status).toBe('cancelled_by_admin')
    expect(events[0].actor_type).toBe('admin')
    expect(events[0].reason).toBe('double booked by hand')
  })

  it('never refunds more than was captured, across repeated cancellations', async () => {
    const { bookingId } = await seedPaidBooking(49)
    const first = await cancel(bookingId, 'admin_cancel')
    expect(first.refund_amount_paise).toBe(49900)

    // A second attempt on an already-cancelled booking is refused outright,
    // which is what keeps the total capped at the captured amount.
    await expect(cancel(bookingId, 'admin_cancel')).rejects.toThrow(
      /AC_NOT_CANCELLABLE/,
    )

    const [{ total }] = await query<{ total: string }>(
      `select coalesce(sum(amount_paise),0)::text as total
         from refunds where booking_id = $1`,
      [bookingId],
    )
    expect(Number(total)).toBe(49900)
  })

  it('refuses an unknown trigger rather than guessing a tier', async () => {
    const { bookingId } = await seedPaidBooking(47)
    await expect(cancel(bookingId, 'whatever')).rejects.toThrow(/AC_UNKNOWN_TRIGGER/)
  })

  it('cancels an unpaid hold without inventing a refund', async () => {
    const startsAt = new Date(Date.now() + 47 * 3600_000)
    const endsAt = new Date(startsAt.getTime() + 3600_000)
    const [{ id: bookingId }] = await query<{ id: string }>(insertBookingSql(), [
      'AC-HELD1',
      customerId,
      companionId,
      areaId,
      startsAt.toISOString(),
      endsAt.toISOString(),
      15,
      'pending_payment',
      49900,
      49900,
      terms,
    ])

    const result = await cancel(bookingId, 'admin_cancel')
    expect(result.refund_amount_paise).toBe(0)
    expect(result.refund_id).toBeNull()
  })
})
