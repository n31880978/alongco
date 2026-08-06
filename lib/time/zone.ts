/**
 * Timezone helpers.
 *
 * Every instant is stored and passed around as a real UTC `Date`. These convert
 * to and from IST wall-clock, which is what service hours, weekly availability
 * rules and everything a customer reads are expressed in (CLAUDE.md §6).
 *
 * Implemented on Intl rather than a fixed +05:30 so the same code is correct if
 * a second city ever lands in a zone that observes DST.
 */

export const IST = 'Asia/Kolkata'

export type ZonedParts = {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
  weekday: number // 0 = Sunday, matching companion_availability.weekday
}

const partsCache = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
    partsCache.set(timeZone, f)
  }
  return f
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

export function zonedParts(date: Date, timeZone: string = IST): ZonedParts {
  const parts = formatter(timeZone).formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0'
  // Intl renders midnight as hour 24 in some engines.
  const hour = Number(get('hour')) % 24
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute')),
    weekday: WEEKDAYS[get('weekday')] ?? 0,
  }
}

/** Offset of `timeZone` from UTC, in ms, at the given instant. */
function offsetAt(utcMs: number, timeZone: string): number {
  const p = zonedParts(new Date(utcMs), timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0)
  // Seconds and ms are unchanged by any real zone offset, so ignoring them here
  // is safe and keeps the round trip exact to the minute.
  const seconds = new Date(utcMs).getUTCSeconds()
  const ms = new Date(utcMs).getUTCMilliseconds()
  return asUtc + seconds * 1000 + ms - utcMs
}

/** Build the UTC instant for a wall-clock time in `timeZone`. */
export function fromZoned(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string = IST,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  // One correction pass is enough for every real zone: the guess can only be
  // wrong by the offset itself, and re-measuring at the corrected instant lands
  // on the right side of any transition.
  let utc = naive - offsetAt(naive, timeZone)
  utc = naive - offsetAt(utc, timeZone)
  return new Date(utc)
}

/** 'YYYY-MM-DD' for the local date in `timeZone`. */
export function zonedDateKey(date: Date, timeZone: string = IST): string {
  const p = zonedParts(date, timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** Minutes past local midnight. */
export function minutesOfDay(date: Date, timeZone: string = IST): number {
  const p = zonedParts(date, timeZone)
  return p.hour * 60 + p.minute
}

/** 'HH:MM' -> minutes past midnight. */
export function parseClock(clock: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(clock)
  if (!m) throw new Error(`Invalid time: ${clock}`)
  return Number(m[1]) * 60 + Number(m[2])
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000)
}

/** '4:00 PM' — the chip label in the design canvas. */
export function formatSlotLabel(date: Date, timeZone: string = IST): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(date)
    .replace(/\s?([ap])\.?m\.?/i, (_, p: string) => ` ${p.toUpperCase()}M`)
}

export function formatDateLong(date: Date, timeZone: string = IST): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date)
}

export function formatDateShort(date: Date, timeZone: string = IST): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    day: 'numeric',
    month: 'short',
  }).format(date)
}
