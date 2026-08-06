/**
 * Availability. CLAUDE.md §4: computed, never stored. There is no slots table.
 *
 * Pure — no database, no clock of its own, no imports beyond timezone helpers.
 * `now` is always passed in, which is what makes the day-rollover and
 * slot-in-the-past cases testable.
 *
 * Inputs come from the get_availability_inputs RPC, which returns bare time
 * windows with no reason text, no customer and no reference attached, so
 * nothing here can leak who booked what.
 */

import {
  IST,
  addMinutes,
  fromZoned,
  minutesOfDay,
  parseClock,
  zonedDateKey,
  zonedParts,
} from '@/lib/time/zone'

export type WeeklyRule = {
  weekday: number // 0 = Sunday, IST
  start_time: string // 'HH:MM'
  end_time: string // 'HH:MM'
}

export type Window = {
  starts_at: string | Date
  /** For `busy` windows this already includes that booking's trailing buffer. */
  ends_at: string | Date
}

export type AvailabilityInputs = {
  rules: WeeklyRule[]
  blackouts: Window[]
  busy: Window[]
}

export type AvailabilityOptions = {
  now: Date
  durationMinutes: number
  bufferMinutes: number
  serviceHours: { start: string; end: string }
  bookingWindowDays: number
  /** Granularity of offered start times. */
  stepMinutes?: number
  timeZone?: string
  /** Slots closer than this to `now` are not offered. */
  leadMinutes?: number
}

export type Slot = {
  startsAt: Date
  endsAt: Date
  available: boolean
  /** Why not, when unavailable. Taken slots are shown disabled, not hidden. */
  reason?: 'taken' | 'past' | 'blackout'
}

export type DayAvailability = {
  /** 'YYYY-MM-DD' in IST. */
  date: string
  slots: Slot[]
  hasAvailable: boolean
}

const DEFAULT_STEP = 30
const DEFAULT_LEAD = 0

function toDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v)
}

/**
 * Days in the rolling window, each with every candidate start time inside the
 * companion's working hours for that weekday.
 *
 * PRD §6.2: taken slots are returned with `available: false` rather than
 * omitted — the cinema-seat model communicates that the service is real and in
 * use. Times outside working hours are omitted entirely; they were never on
 * offer.
 */
export function computeAvailability(
  inputs: AvailabilityInputs,
  options: AvailabilityOptions,
): DayAvailability[] {
  const {
    now,
    durationMinutes,
    bufferMinutes,
    serviceHours,
    bookingWindowDays,
    stepMinutes = DEFAULT_STEP,
    timeZone = IST,
    leadMinutes = DEFAULT_LEAD,
  } = options

  if (durationMinutes <= 0) throw new Error('durationMinutes must be positive')
  if (bookingWindowDays <= 0) throw new Error('bookingWindowDays must be positive')

  const serviceStart = parseClock(serviceHours.start)
  const serviceEnd = parseClock(serviceHours.end)

  const windowEnd = addMinutes(now, bookingWindowDays * 24 * 60)
  const earliest = addMinutes(now, leadMinutes)

  const blackouts = inputs.blackouts.map((b) => ({
    start: toDate(b.starts_at).getTime(),
    end: toDate(b.ends_at).getTime(),
  }))
  const busy = inputs.busy.map((b) => ({
    start: toDate(b.starts_at).getTime(),
    end: toDate(b.ends_at).getTime(),
  }))

  const days: DayAvailability[] = []
  const startParts = zonedParts(now, timeZone)

  for (let dayOffset = 0; dayOffset <= bookingWindowDays; dayOffset++) {
    // Step by local calendar day, so a DST shift can never drop or duplicate one.
    const dayAnchor = fromZoned(
      startParts.year,
      startParts.month,
      startParts.day + dayOffset,
      12,
      0,
      timeZone,
    )
    const parts = zonedParts(dayAnchor, timeZone)
    const dateKey = zonedDateKey(dayAnchor, timeZone)

    const rules = inputs.rules.filter((r) => r.weekday === parts.weekday)
    if (rules.length === 0) continue

    const slots: Slot[] = []
    const seen = new Set<number>()

    for (const rule of rules) {
      const ruleStart = Math.max(parseClock(rule.start_time), serviceStart)
      const ruleEnd = Math.min(parseClock(rule.end_time), serviceEnd)

      for (
        let minute = ceilTo(ruleStart, stepMinutes);
        // A slot ending after the working window or after 22:00 is never offered.
        minute + durationMinutes <= ruleEnd;
        minute += stepMinutes
      ) {
        const startsAt = fromZoned(
          parts.year,
          parts.month,
          parts.day,
          Math.floor(minute / 60),
          minute % 60,
          timeZone,
        )
        if (seen.has(startsAt.getTime())) continue
        seen.add(startsAt.getTime())

        const endsAt = addMinutes(startsAt, durationMinutes)

        // Outside the rolling booking window entirely — do not render it.
        if (startsAt.getTime() > windowEnd.getTime()) continue

        let available = true
        let reason: Slot['reason']

        if (startsAt.getTime() < earliest.getTime()) {
          available = false
          reason = 'past'
        } else if (overlapsAny(startsAt, endsAt, blackouts, 0)) {
          available = false
          reason = 'blackout'
        } else if (overlapsAny(startsAt, endsAt, busy, bufferMinutes)) {
          // Mirrors bookings_no_overlap exactly: this slot's reserved period is
          // [start, end + buffer), and `busy` already carries the other
          // booking's buffer. A booking ending 15:00 therefore blocks a 15:10
          // start and permits 15:15.
          available = false
          reason = 'taken'
        }

        slots.push({ startsAt, endsAt, available, reason })
      }
    }

    if (slots.length === 0) continue

    slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())

    // A day entirely in the past adds nothing — drop it rather than render a
    // strip of dead chips.
    if (slots.every((s) => s.reason === 'past')) continue

    days.push({
      date: dateKey,
      slots,
      hasAvailable: slots.some((s) => s.available),
    })
  }

  return days
}

/**
 * The next date with a free slot, for the fully-booked empty state
 * ("His next free slot is Tuesday" in the design canvas).
 */
export function nextAvailableDate(days: DayAvailability[], after?: string): string | null {
  const candidates = after ? days.filter((d) => d.date > after) : days
  return candidates.find((d) => d.hasAvailable)?.date ?? null
}

export function findDay(days: DayAvailability[], date: string): DayAvailability | undefined {
  return days.find((d) => d.date === date)
}

/**
 * Whether a specific start is still offerable. Used to re-check a selection
 * before creating a hold, so a stale page gets a specific message rather than a
 * database error. The database is still the authority (§3.5).
 */
export function isSlotOffered(
  days: DayAvailability[],
  startsAt: Date,
): boolean {
  const t = startsAt.getTime()
  return days.some((d) =>
    d.slots.some((s) => s.startsAt.getTime() === t && s.available),
  )
}

function ceilTo(value: number, step: number): number {
  return Math.ceil(value / step) * step
}

function overlapsAny(
  startsAt: Date,
  endsAt: Date,
  windows: { start: number; end: number }[],
  trailingBufferMinutes: number,
): boolean {
  const start = startsAt.getTime()
  const end = endsAt.getTime() + trailingBufferMinutes * 60_000
  // Half-open [start, end), matching the '[)' bound on reserved_period.
  return windows.some((w) => start < w.end && end > w.start)
}

/** Minutes of day in IST, exported for the picker's grouping. */
export function slotMinutesOfDay(slot: Slot, timeZone: string = IST): number {
  return minutesOfDay(slot.startsAt, timeZone)
}
