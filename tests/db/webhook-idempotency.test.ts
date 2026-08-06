import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import {
  closePool,
  createArea,
  createCompanion,
  createCustomer,
  insertBookingSql,
  query,
  resetData,
} from '../helpers/db'

/**
 * T12 — "replaying the same webhook three times confirms once". PRD §6.6.
 *
 * The route's idempotency rests on two database guarantees, and this exercises
 * both against a real Postgres rather than mocking the handler:
 *
 *   1. webhook_events has a unique (provider, event_id), so a redelivery loses
 *      the insert and the handler returns early.
 *   2. ac_set_booking_status is a no-op when the status already matches, so even
 *      if a duplicate slipped past, no second booking_events row is written.
 */

describe('webhook idempotency', () => {
  let bookingId: string
  let paymentId: string

  beforeEach(async () => {
    await resetData()
    const areaId = await createArea()
    const companionId = await createCompanion({ areas: [areaId] })
    const customer = await createCustomer()

    const [booking] = await query<{ id: string }>(insertBookingSql(), [
      'AC-HOOK01',
      customer.id,
      companionId,
      areaId,
      '2027-03-10T14:00:00+05:30',
      '2027-03-10T15:00:00+05:30',
      15,
      'pending_payment',
      49900,
      49900,
      '2026-08-01',
    ])
    bookingId = booking.id

    const [payment] = await query<{ id: string }>(
      `insert into payments (booking_id, provider_order_id, amount_paise, status)
       values ($1, 'AC-HOOK01-A', 49900, 'created') returning id`,
      [bookingId],
    )
    paymentId = payment.id
  })

  afterAll(closePool)

  /** What the route does once a webhook is claimed. */
  async function claimAndProcess(eventId: string): Promise<'claimed' | 'duplicate'> {
    try {
      await query(
        `insert into webhook_events (provider, event_id, event_type, payload)
         values ('cashfree', $1, 'PAYMENT_SUCCESS_WEBHOOK', '{}'::jsonb)`,
        [eventId],
      )
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return 'duplicate'
      throw error
    }

    await query(
      `update payments set status = 'captured', captured_at = now() where id = $1`,
      [paymentId],
    )
    await query(
      `select ac_set_booking_status($1, 'confirmed', 'system', null, 'payment captured')`,
      [bookingId],
    )
    await query(
      `update webhook_events set processed_at = now()
        where provider = 'cashfree' and event_id = $1`,
      [eventId],
    )
    return 'claimed'
  }

  it('confirms once when the same event is delivered three times', async () => {
    const results = []
    for (let i = 0; i < 3; i++) {
      results.push(await claimAndProcess('PAYMENT_SUCCESS_WEBHOOK:987654'))
    }

    expect(results).toEqual(['claimed', 'duplicate', 'duplicate'])

    const [booking] = await query<{ status: string }>(
      `select status from bookings where id = $1`,
      [bookingId],
    )
    expect(booking.status).toBe('confirmed')

    // Exactly one transition recorded, not three.
    const events = await query(
      `select id from booking_events where booking_id = $1 and to_status = 'confirmed'`,
      [bookingId],
    )
    expect(events).toHaveLength(1)

    const stored = await query(
      `select id from webhook_events where event_id = 'PAYMENT_SUCCESS_WEBHOOK:987654'`,
    )
    expect(stored).toHaveLength(1)
  })

  it('confirms once when three deliveries arrive concurrently', async () => {
    const results = await Promise.all(
      Array.from({ length: 3 }, () => claimAndProcess('PAYMENT_SUCCESS_WEBHOOK:1122')),
    )

    expect(results.filter((r) => r === 'claimed')).toHaveLength(1)

    const events = await query(
      `select id from booking_events where booking_id = $1 and to_status = 'confirmed'`,
      [bookingId],
    )
    expect(events).toHaveLength(1)
  })

  it('writes no second event when the status is already confirmed', async () => {
    await query(
      `select ac_set_booking_status($1, 'confirmed', 'system', null, 'first')`,
      [bookingId],
    )
    await query(
      `select ac_set_booking_status($1, 'confirmed', 'system', null, 'again')`,
      [bookingId],
    )

    const events = await query(
      `select id from booking_events where booking_id = $1 and to_status = 'confirmed'`,
      [bookingId],
    )
    expect(events).toHaveLength(1)
  })

  it('keeps the slot blocked once confirmed', async () => {
    await claimAndProcess('PAYMENT_SUCCESS_WEBHOOK:3344')

    const [{ companion_id, area_id }] = await query<{
      companion_id: string
      area_id: string
    }>(`select companion_id, area_id from bookings where id = $1`, [bookingId])
    const other = await createCustomer()

    await expect(
      query(insertBookingSql(), [
        'AC-CLASH1',
        other.id,
        companion_id,
        area_id,
        '2027-03-10T14:00:00+05:30',
        '2027-03-10T15:00:00+05:30',
        15,
        'pending_payment',
        49900,
        49900,
        '2026-08-01',
      ]),
    ).rejects.toThrow(/bookings_no_overlap|exclusion/i)
  })

  it('distinguishes a failure event from the success event for the same payment', async () => {
    await claimAndProcess('PAYMENT_SUCCESS_WEBHOOK:5566')
    // A different event type is a different row, so it is not swallowed.
    const outcome = await claimAndProcess('PAYMENT_FAILED_WEBHOOK:5566')
    expect(outcome).toBe('claimed')
  })

  it('records confirmed_at exactly once', async () => {
    await claimAndProcess('PAYMENT_SUCCESS_WEBHOOK:7788')
    const [first] = await query<{ confirmed_at: string }>(
      `select confirmed_at from bookings where id = $1`,
      [bookingId],
    )

    await query(
      `select ac_set_booking_status($1, 'confirmed', 'system', null, 'again')`,
      [bookingId],
    )
    const [second] = await query<{ confirmed_at: string }>(
      `select confirmed_at from bookings where id = $1`,
      [bookingId],
    )

    expect(second.confirmed_at).toEqual(first.confirmed_at)
  })
})
