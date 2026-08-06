import { describe, it, expect } from 'vitest'
import {
  computeAvailability,
  findDay,
  isSlotOffered,
  nextAvailableDate,
  type AvailabilityInputs,
} from '@/lib/booking/availability'
import { fromZoned, formatSlotLabel, zonedDateKey } from '@/lib/time/zone'

/**
 * T6 — the availability engine. PRD §6.2.
 *
 * `now` is injected, so every case here is deterministic: no test depends on
 * what time it happens to be when it runs.
 */

const SERVICE = { start: '08:00', end: '22:00' }

/** Wednesday 10 March 2027, 09:00 IST. */
const NOW = fromZoned(2027, 3, 10, 9, 0)

function ist(day: number, hour: number, minute = 0): Date {
  return fromZoned(2027, 3, day, hour, minute)
}

const allWeek = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  start_time: '08:00',
  end_time: '22:00',
}))

function inputs(over: Partial<AvailabilityInputs> = {}): AvailabilityInputs {
  return { rules: allWeek, blackouts: [], busy: [], ...over }
}

const opts = (over: Partial<Parameters<typeof computeAvailability>[1]> = {}) => ({
  now: NOW,
  durationMinutes: 60,
  bufferMinutes: 15,
  serviceHours: SERVICE,
  bookingWindowDays: 7,
  ...over,
})

describe('service hours', () => {
  it('offers nothing starting before 08:00', () => {
    const days = computeAvailability(inputs(), opts())
    const first = days[0].slots[0]
    expect(formatSlotLabel(first.startsAt)).toBe('8:00 AM')
  })

  it('offers no slot that would end after 22:00', () => {
    const days = computeAvailability(inputs(), opts())
    const day = findDay(days, '2027-03-11')!
    const last = day.slots[day.slots.length - 1]
    expect(formatSlotLabel(last.startsAt)).toBe('9:00 PM')
    expect(formatSlotLabel(last.endsAt)).toBe('10:00 PM')
  })

  it('shortens the last offered start as the duration grows', () => {
    const three = computeAvailability(inputs(), opts({ durationMinutes: 180 }))
    const day = findDay(three, '2027-03-11')!
    const last = day.slots[day.slots.length - 1]
    expect(formatSlotLabel(last.startsAt)).toBe('7:00 PM')
  })

  it('clamps to the companion’s own hours, not just service hours', () => {
    const days = computeAvailability(
      inputs({ rules: [{ weekday: 4, start_time: '17:00', end_time: '20:00' }] }),
      opts(),
    )
    // Thursday 11 March 2027 is weekday 4.
    const day = findDay(days, '2027-03-11')!
    expect(formatSlotLabel(day.slots[0].startsAt)).toBe('5:00 PM')
    expect(formatSlotLabel(day.slots[day.slots.length - 1].startsAt)).toBe('7:00 PM')
  })
})

describe('the booking window', () => {
  it('spans the rolling 7 days and no further', () => {
    const days = computeAvailability(inputs(), opts())
    expect(days[0].date).toBe('2027-03-10')
    expect(days[days.length - 1].date).toBe('2027-03-17')
    expect(days.length).toBeLessThanOrEqual(8)
  })

  it('omits days the companion does not work', () => {
    const days = computeAvailability(
      inputs({ rules: [{ weekday: 6, start_time: '10:00', end_time: '18:00' }] }),
      opts(),
    )
    expect(days.map((d) => d.date)).toEqual(['2027-03-13'])
  })
})

describe('slots in the past', () => {
  it('marks today’s earlier slots unavailable rather than offering them', () => {
    const days = computeAvailability(inputs(), opts())
    const today = findDay(days, '2027-03-10')!
    const eight = today.slots.find((s) => formatSlotLabel(s.startsAt) === '8:00 AM')!
    expect(eight.available).toBe(false)
    expect(eight.reason).toBe('past')
  })

  it('offers the first slot after now', () => {
    const days = computeAvailability(inputs(), opts())
    const today = findDay(days, '2027-03-10')!
    const first = today.slots.find((s) => s.available)!
    expect(formatSlotLabel(first.startsAt)).toBe('9:00 AM')
  })

  it('never offers a past slot when the hour rolls over mid-session', () => {
    // Same inputs, recomputed at 13:20 — 13:00 must stop being offered and
    // 13:30 must be the next one up.
    const later = computeAvailability(inputs(), opts({ now: ist(10, 13, 20) }))
    const today = findDay(later, '2027-03-10')!
    const thirteen = today.slots.find((s) => formatSlotLabel(s.startsAt) === '1:00 PM')!
    expect(thirteen.available).toBe(false)
    expect(thirteen.reason).toBe('past')

    const next = today.slots.find((s) => s.available)!
    expect(formatSlotLabel(next.startsAt)).toBe('1:30 PM')
  })

  it('drops a day once every slot on it is in the past', () => {
    const late = computeAvailability(inputs(), opts({ now: ist(10, 21, 30) }))
    expect(late.map((d) => d.date)).not.toContain('2027-03-10')
    expect(late[0].date).toBe('2027-03-11')
  })

  it('honours a lead time', () => {
    const days = computeAvailability(inputs(), opts({ leadMinutes: 120 }))
    const today = findDay(days, '2027-03-10')!
    const first = today.slots.find((s) => s.available)!
    expect(formatSlotLabel(first.startsAt)).toBe('11:00 AM')
  })
})

describe('the trailing buffer — PRD §6.2 acceptance', () => {
  // A booking 14:00–15:00 arrives as a busy window already extended to 15:15.
  const busy = [{ starts_at: ist(11, 14), ends_at: ist(11, 15, 15) }]

  it('does not offer any slot starting before 15:15', () => {
    const days = computeAvailability(inputs({ busy }), opts())
    const day = findDay(days, '2027-03-11')!
    const offered = day.slots.filter((s) => s.available).map((s) => formatSlotLabel(s.startsAt))

    expect(offered).not.toContain('2:30 PM')
    expect(offered).not.toContain('3:00 PM')
    expect(offered).not.toContain('3:10 PM')
    expect(offered).toContain('3:30 PM')
  })

  it('marks 15:00 taken, not hidden', () => {
    const days = computeAvailability(inputs({ busy }), opts())
    const day = findDay(days, '2027-03-11')!
    const three = day.slots.find((s) => formatSlotLabel(s.startsAt) === '3:00 PM')!
    expect(three.available).toBe(false)
    expect(three.reason).toBe('taken')
  })

  it('offers 15:15 exactly when the step allows it', () => {
    const days = computeAvailability(inputs({ busy }), opts({ stepMinutes: 15 }))
    const day = findDay(days, '2027-03-11')!
    const boundary = day.slots.find((s) => formatSlotLabel(s.startsAt) === '3:15 PM')!
    expect(boundary.available).toBe(true)

    const before = day.slots.find((s) => formatSlotLabel(s.startsAt) === '3:00 PM')!
    expect(before.available).toBe(false)
  })

  it('blocks a slot whose own buffer would run into the next booking', () => {
    const days = computeAvailability(inputs({ busy }), opts())
    const day = findDay(days, '2027-03-11')!
    // 12:45–13:45 + 15 buffer ends 14:00, exactly touching. Half-open, so free.
    const ok = day.slots.find((s) => formatSlotLabel(s.startsAt) === '12:45 PM')
    if (ok) expect(ok.available).toBe(true)

    // 13:00–14:00 + buffer to 14:15 overlaps the 14:00 start.
    const clash = day.slots.find((s) => formatSlotLabel(s.startsAt) === '1:00 PM')!
    expect(clash.available).toBe(false)
    expect(clash.reason).toBe('taken')
  })
})

describe('blackouts', () => {
  it('marks a mid-day blackout unavailable', () => {
    const days = computeAvailability(
      inputs({ blackouts: [{ starts_at: ist(11, 12), ends_at: ist(11, 15) }] }),
      opts(),
    )
    const day = findDay(days, '2027-03-11')!
    const noon = day.slots.find((s) => formatSlotLabel(s.startsAt) === '12:00 PM')!
    expect(noon.available).toBe(false)
    expect(noon.reason).toBe('blackout')

    const after = day.slots.find((s) => formatSlotLabel(s.startsAt) === '3:00 PM')!
    expect(after.available).toBe(true)
  })

  it('does not extend a blackout by the buffer', () => {
    const days = computeAvailability(
      inputs({ blackouts: [{ starts_at: ist(11, 12), ends_at: ist(11, 13) }] }),
      opts(),
    )
    const day = findDay(days, '2027-03-11')!
    const at13 = day.slots.find((s) => formatSlotLabel(s.startsAt) === '1:00 PM')!
    expect(at13.available).toBe(true)
  })
})

describe('a fully booked day', () => {
  const fullDay = Array.from({ length: 14 }, (_, i) => ({
    starts_at: ist(11, 8 + i),
    ends_at: ist(11, 9 + i, 15),
  }))

  it('reports no availability but still renders the slots', () => {
    const days = computeAvailability(inputs({ busy: fullDay }), opts())
    const day = findDay(days, '2027-03-11')!
    expect(day.hasAvailable).toBe(false)
    expect(day.slots.length).toBeGreaterThan(0)
    expect(day.slots.every((s) => !s.available)).toBe(true)
  })

  it('offers the next free date for the empty state', () => {
    const days = computeAvailability(inputs({ busy: fullDay }), opts())
    expect(nextAvailableDate(days, '2027-03-11')).toBe('2027-03-12')
  })

  it('returns null when nothing at all is free', () => {
    const everyDay = Array.from({ length: 8 }, (_, d) =>
      Array.from({ length: 14 }, (_, i) => ({
        starts_at: ist(10 + d, 8 + i),
        ends_at: ist(10 + d, 9 + i, 15),
      })),
    ).flat()
    const days = computeAvailability(inputs({ busy: everyDay }), opts())
    expect(nextAvailableDate(days)).toBeNull()
  })
})

describe('day rollover', () => {
  it('never produces a slot that crosses midnight', () => {
    const days = computeAvailability(inputs(), opts({ durationMinutes: 180 }))
    for (const day of days) {
      for (const slot of day.slots) {
        expect(zonedDateKey(slot.startsAt)).toBe(day.date)
        // 22:00 is the boundary; an end exactly at 22:00 stays on the same day.
        expect(zonedDateKey(new Date(slot.endsAt.getTime() - 1))).toBe(day.date)
      }
    }
  })

  it('advances the strip when now crosses into the next day', () => {
    const days = computeAvailability(inputs(), opts({ now: ist(10, 23, 45) }))
    expect(days[0].date).toBe('2027-03-11')
  })

  it('groups slots under the IST date, not UTC', () => {
    // 21:00 IST on the 11th is 15:30 UTC on the 11th; 08:00 IST on the 11th is
    // 02:30 UTC on the same day. Both must land under 2027-03-11.
    const days = computeAvailability(inputs(), opts())
    const day = findDay(days, '2027-03-11')!
    expect(day.slots[0].startsAt.toISOString()).toBe('2027-03-11T02:30:00.000Z')
  })
})

describe('isSlotOffered', () => {
  it('accepts a slot that is free and rejects one that is taken', () => {
    const days = computeAvailability(
      inputs({ busy: [{ starts_at: ist(11, 14), ends_at: ist(11, 15, 15) }] }),
      opts(),
    )
    expect(isSlotOffered(days, ist(11, 16))).toBe(true)
    expect(isSlotOffered(days, ist(11, 14))).toBe(false)
    expect(isSlotOffered(days, ist(11, 3))).toBe(false)
  })
})
