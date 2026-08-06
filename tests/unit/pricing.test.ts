import { describe, it, expect } from 'vitest'
import {
  DEFAULT_DURATION_DISCOUNTS,
  discountPercentFor,
  formatPaise,
  quote,
} from '@/lib/booking/pricing'

const RATE = 49900 // ₹499/hour, the launch base rate

describe('discount tiers', () => {
  it('matches the design canvas price table', () => {
    expect(quote(RATE, 60).amountPaise).toBe(49900) // ₹499
    expect(quote(RATE, 120).amountPaise).toBe(89800) // ₹898, −10%
    expect(quote(RATE, 180).amountPaise).toBe(104800) // ₹1,048, −30%
  })

  it('applies 0% below two hours, 10% from two, 30% from three', () => {
    expect(discountPercentFor(60)).toBe(0)
    expect(discountPercentFor(90)).toBe(0)
    expect(discountPercentFor(119)).toBe(0)
    expect(discountPercentFor(120)).toBe(10)
    expect(discountPercentFor(179)).toBe(10)
    expect(discountPercentFor(180)).toBe(30)
    expect(discountPercentFor(240)).toBe(30)
  })

  it('reports the gross and the saving for the comparison price', () => {
    const q = quote(RATE, 120)
    expect(q.grossPaise).toBe(99800)
    expect(q.savingPaise).toBe(10000)
    expect(q.discountPercent).toBe(10)
  })
})

describe('rounding', () => {
  it('rounds to the nearest whole rupee', () => {
    // 2h at −10% is exactly ₹898.20 -> ₹898
    expect(quote(RATE, 120).amountPaise).toBe(89800)
    // 3h at −30% is exactly ₹1,047.90 -> ₹1,048
    expect(quote(RATE, 180).amountPaise).toBe(104800)
  })

  it('rounds a half rupee away from zero, matching Postgres round()', () => {
    // 1h at ₹499.00 with no discount is exact; force a .5 with an odd rate.
    // 50 paise/hour for 90 minutes = 75 paise = ₹0.75 -> ₹1
    expect(quote(50, 90, [{ min_minutes: 60, percent: 0 }]).amountPaise).toBe(100)
    // 50 paise/hour for 60 minutes = ₹0.50 -> ₹1 (half away from zero)
    expect(quote(50, 60, [{ min_minutes: 60, percent: 0 }]).amountPaise).toBe(100)
  })

  it('always returns whole rupees in paise', () => {
    for (let minutes = 60; minutes <= 480; minutes += 30) {
      expect(quote(RATE, minutes).amountPaise % 100).toBe(0)
    }
  })

  it('never returns a float', () => {
    for (let rate = 10000; rate <= 200000; rate += 3700) {
      for (const minutes of [60, 90, 120, 150, 180, 240]) {
        const { amountPaise } = quote(rate, minutes)
        expect(Number.isInteger(amountPaise)).toBe(true)
      }
    }
  })
})

describe('input validation', () => {
  it('rejects a non-integer or non-positive rate', () => {
    expect(() => quote(0, 60)).toThrow()
    expect(() => quote(-1, 60)).toThrow()
    expect(() => quote(499.5, 60)).toThrow()
  })

  it('rejects a non-positive duration', () => {
    expect(() => quote(RATE, 0)).toThrow()
    expect(() => quote(RATE, -60)).toThrow()
  })

  it('refuses to silently lose precision on an absurd rate', () => {
    expect(() => quote(Number.MAX_SAFE_INTEGER, 180)).toThrow(/overflow/)
  })
})

describe('formatting', () => {
  it('uses Indian digit grouping with no decimals', () => {
    expect(formatPaise(49900)).toBe('₹499')
    expect(formatPaise(104800)).toBe('₹1,048')
    expect(formatPaise(1234500)).toBe('₹12,345')
  })

  it('rejects a fractional paise amount', () => {
    expect(() => formatPaise(100.5)).toThrow()
  })
})

describe('settings-driven tiers', () => {
  it('honours a different tier table without a code change', () => {
    const custom = [
      { min_minutes: 240, percent: 40 },
      { min_minutes: 60, percent: 0 },
    ]
    expect(quote(RATE, 180, custom).discountPercent).toBe(0)
    expect(quote(RATE, 240, custom).discountPercent).toBe(40)
  })

  it('falls back to no discount when no tier matches', () => {
    expect(discountPercentFor(30, DEFAULT_DURATION_DISCOUNTS)).toBe(0)
  })
})
