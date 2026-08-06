import { IST, fromZoned, zonedParts } from '@/lib/time/zone'

/**
 * IST day and week boundaries for the admin reads.
 *
 * The operator's "today" is an IST calendar day, not a UTC one — a booking at
 * 03:00 IST belongs to that morning, and a naive UTC window would file it under
 * the day before (CLAUDE.md §6).
 */

export function startOfDayIST(at: Date = new Date(), timeZone: string = IST): Date {
  const p = zonedParts(at, timeZone)
  return fromZoned(p.year, p.month, p.day, 0, 0, timeZone)
}

export function addDays(date: Date, days: number, timeZone: string = IST): Date {
  const p = zonedParts(date, timeZone)
  return fromZoned(p.year, p.month, p.day + days, p.hour, p.minute, timeZone)
}

/** Monday-anchored, matching the "week to 6 Aug" framing on the payments screen. */
export function startOfWeekIST(at: Date = new Date(), timeZone: string = IST): Date {
  const start = startOfDayIST(at, timeZone)
  const weekday = zonedParts(start, timeZone).weekday // 0 = Sunday
  const backToMonday = (weekday + 6) % 7
  return addDays(start, -backToMonday, timeZone)
}

export function startOfMonthIST(at: Date = new Date(), timeZone: string = IST): Date {
  const p = zonedParts(at, timeZone)
  return fromZoned(p.year, p.month, 1, 0, 0, timeZone)
}
