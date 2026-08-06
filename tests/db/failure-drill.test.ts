import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  closePool,
  createArea,
  createCompanion,
  createCustomer,
  currentTermsVersion,
  insertBookingSql,
  query,
  resetData,
} from '../helpers/db'

/**
 * TASKS T24 — deliberately break things and assert on what surfaces.
 *
 * The scenarios T24 names are covered as follows:
 *
 *   duplicate webhook     tests/db/webhook-idempotency.test.ts
 *   concurrent slot grab  tests/db/overlap.test.ts (2 and 10 racing inserts)
 *   failed refund         tests/db/admin-cancel.test.ts (refund stays 'created')
 *   expired hold mid-checkout   here — including the case that loses money
 *
 * The last one is the dangerous one, so it gets its own file: the hold expires
 * while she is on the Cashfree page, the slot is resold, and *then* her payment
 * succeeds. The database must refuse to confirm, because confirming would put
 * two customers in front of one companion.
 */

let areaId: string
let companionId: string
let terms: string

async function booking(
  status: string,
  hoursOut: number,
  customerId: string,
  reference: string,
) {
  const startsAt = new Date(Date.now() + hoursOut * 3600_000)
  const endsAt = new Date(startsAt.getTime() + 3600_000)
  const [{ id }] = await query<{ id: string }>(insertBookingSql(), [
    reference,
    customerId,
    companionId,
    areaId,
    startsAt.toISOString(),
    endsAt.toISOString(),
    15,
    status,
    49900,
    49900,
    terms,
  ])
  return { id, startsAt, endsAt }
}

beforeEach(async () => {
  await resetData()
  areaId = await createArea()
  companionId = await createCompanion({ areas: [areaId] })
  terms = await currentTermsVersion()
})

afterAll(closePool)

describe('T24 · expired hold, payment arrives late', () => {
  it('confirms the late payment when the slot is still free', async () => {
    const her = (await createCustomer()).id
    const { id } = await booking('expired', 30, her, 'AC-LATE01')

    // Nobody else took the slot, so she should simply get her booking.
    const [{ ac_set_booking_status: from }] = await query<{
      ac_set_booking_status: string
    }>(
      `select ac_set_booking_status($1,'confirmed','system',null,'payment captured')`,
      [id],
    )
    expect(from).toBe('expired')

    const [row] = await query(`select status from bookings where id = $1`, [id])
    expect(row.status).toBe('confirmed')
  })

  it('refuses to confirm when the slot was resold — no double booking', async () => {
    const her = (await createCustomer()).id
    const other = (await createCustomer()).id

    const { id, startsAt, endsAt } = await booking('expired', 30, her, 'AC-LATE02')

    // Someone else took the freed slot while she was on the payment page.
    await query(insertBookingSql(), [
      'AC-RESOLD',
      other,
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

    // Her payment now succeeds. Confirming it would put two customers in front
    // of one companion, so the exclusion constraint must reject it. 23P01 is
    // what the webhook handler keys on to page an operator for a refund rather
    // than looping Cashfree forever.
    await expect(
      query(
        `select ac_set_booking_status($1,'confirmed','system',null,'payment captured')`,
        [id],
      ),
    ).rejects.toMatchObject({ code: '23P01' })

    // Her booking is untouched, and the other customer keeps the slot.
    const [hers] = await query(`select status from bookings where id = $1`, [id])
    expect(hers.status).toBe('expired')

    const confirmed = await query(
      `select id from bookings where companion_id = $1 and status = 'confirmed'`,
      [companionId],
    )
    expect(confirmed).toHaveLength(1)
  })

  it('leaves a captured payment on an unconfirmed booking findable by admin', async () => {
    const her = (await createCustomer()).id
    const { id } = await booking('expired', 30, her, 'AC-LATE03')

    await query(
      `insert into payments (booking_id, provider_order_id, amount_paise, status, captured_at)
       values ($1,$2,$3,'captured', now())`,
      [id, 'order_AC-LATE03', 49900],
    )

    // This is the query the admin dashboard runs: money captured against a
    // booking that is not confirmed or completed. It must not come back empty,
    // or she is charged and nobody ever knows.
    const orphans = await query(
      `select b.reference, p.amount_paise
         from payments p
         join bookings b on b.id = p.booking_id
        where p.status = 'captured'
          and b.status not in ('confirmed','completed')`,
    )
    expect(orphans).toHaveLength(1)
    expect(orphans[0].reference).toBe('AC-LATE03')
    expect(orphans[0].amount_paise).toBe(49900)
  })
})
