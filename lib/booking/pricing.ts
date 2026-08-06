/**
 * Pricing. CLAUDE.md §3.1 and §3.2.
 *
 * Integer paise only — no floats and no toFixed anywhere in this file. The
 * client never sends an amount; this exists so the server and the UI agree on
 * what will be charged before the RPC snapshots it onto the booking.
 *
 * The authoritative implementation is ac_quote() in the database. This mirrors
 * it, and tests/db/pricing-parity.test.ts asserts across a matrix of rates and
 * durations that the two never drift.
 */

export type DurationDiscount = {
  /** Applies from this duration upward. Matched descending, first hit wins. */
  min_minutes: number
  percent: number
}

/**
 * From the design canvas price table: 1h ₹499, 2h ₹898 (−10%), 3h+ ₹1,048 (−30%).
 * Runtime values come from settings.duration_discounts (§3.10); this is only the
 * fallback if settings has not loaded.
 */
export const DEFAULT_DURATION_DISCOUNTS: DurationDiscount[] = [
  { min_minutes: 180, percent: 30 },
  { min_minutes: 120, percent: 10 },
  { min_minutes: 60, percent: 0 },
]

export type Quote = {
  amountPaise: number
  discountPercent: number
  /** Undiscounted total, for the struck-through comparison price. */
  grossPaise: number
  savingPaise: number
}

export function discountPercentFor(
  minutes: number,
  discounts: DurationDiscount[] = DEFAULT_DURATION_DISCOUNTS,
): number {
  const hit = [...discounts]
    .sort((a, b) => b.min_minutes - a.min_minutes)
    .find((d) => minutes >= d.min_minutes)
  return hit ? hit.percent : 0
}

/**
 * Rounds to the nearest rupee, half away from zero — matching Postgres
 * `round(numeric)` and the design canvas, where ₹898.20 shows as ₹898 and
 * ₹1,047.90 shows as ₹1,048.
 *
 * Kept in integer arithmetic end to end: `amountNum / 600000` is the amount in
 * rupees, so `floor((2·amountNum + 600000) / 1200000)` is that value rounded,
 * with no float division of a fractional intermediate.
 */
export function quote(
  ratePaise: number,
  minutes: number,
  discounts: DurationDiscount[] = DEFAULT_DURATION_DISCOUNTS,
): Quote {
  if (!Number.isInteger(ratePaise) || ratePaise <= 0) {
    throw new Error('ratePaise must be a positive integer')
  }
  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw new Error('minutes must be a positive integer')
  }

  const percent = discountPercentFor(minutes, discounts)
  const grossPaise = roundToRupee(ratePaise * minutes, 100)
  const amountPaise = roundToRupee(ratePaise * minutes, 100 - percent)

  return {
    amountPaise,
    discountPercent: percent,
    grossPaise,
    savingPaise: grossPaise - amountPaise,
  }
}

function roundToRupee(rateTimesMinutes: number, percentOfFull: number): number {
  // rateTimesMinutes/60 paise, times percentOfFull/100, expressed in rupees is
  // (rateTimesMinutes · percentOfFull) / 600000.
  const numerator = rateTimesMinutes * percentOfFull
  if (!Number.isSafeInteger(numerator)) {
    throw new Error('price overflows exact integer arithmetic')
  }
  const rupees = Math.floor((2 * numerator + 600_000) / 1_200_000)
  return rupees * 100
}

/** '₹1,048' — Indian digit grouping, no decimals. Whole rupees only. */
export function formatPaise(paise: number): string {
  if (!Number.isInteger(paise)) throw new Error('paise must be an integer')
  const rupees = paise / 100
  const whole = Number.isInteger(rupees)
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(rupees)
}

/**
 * Razorpay works in integer paise, so nothing in the payment path needs this.
 * Kept for any gateway or report that insists on a rupee decimal — convert only
 * at that boundary, never inside the pricing or refund arithmetic (§3.2).
 */
export function paiseToRupees(paise: number): number {
  if (!Number.isInteger(paise)) throw new Error('paise must be an integer')
  return paise / 100
}
