import { describe, it, expect, afterAll } from 'vitest'
import { closePool, query } from '../helpers/db'
import { quote } from '@/lib/booking/pricing'

/**
 * The price shown to a customer comes from lib/booking/pricing.ts; the price she
 * is charged comes from ac_quote() in the database. Those are two
 * implementations of one rule, so this asserts they agree across the whole
 * matrix rather than at the three durations anyone would think to check.
 */
describe('pricing parity between TypeScript and SQL', () => {
  afterAll(closePool)

  it('agrees on every rate and duration combination', async () => {
    const rates = [10000, 29900, 49900, 75000, 99900, 123456, 250000]
    const durations = [60, 90, 120, 150, 180, 210, 240, 300, 360, 480]

    const rows = await query<{ rate: number; minutes: number; amount_paise: number; discount_percent: number }>(
      `
      select r.rate, m.minutes, q.amount_paise, q.discount_percent
        from unnest($1::int[]) as r(rate)
        cross join unnest($2::int[]) as m(minutes)
        cross join lateral ac_quote(r.rate, m.minutes) q
      `,
      [rates, durations],
    )

    expect(rows).toHaveLength(rates.length * durations.length)

    for (const row of rows) {
      const ts = quote(row.rate, row.minutes)
      expect(
        ts.amountPaise,
        `rate ${row.rate} for ${row.minutes}min`,
      ).toBe(row.amount_paise)
      expect(ts.discountPercent, `rate ${row.rate} for ${row.minutes}min`).toBe(
        row.discount_percent,
      )
    }
  })

  it('agrees on the launch price table exactly', async () => {
    const rows = await query<{ minutes: number; amount_paise: number }>(
      `select m.minutes, q.amount_paise
         from unnest(array[60,120,180]) as m(minutes)
         cross join lateral ac_quote(49900, m.minutes) q
         order by m.minutes`,
    )
    expect(rows.map((r) => r.amount_paise)).toEqual([49900, 89800, 104800])
  })
})
