import { cache } from 'react'
import { createPublicClient } from '@/lib/supabase/public'
import { getSettings } from '@/lib/settings'
import {
  computeAvailability,
  type AvailabilityInputs,
  type DayAvailability,
} from '@/lib/booking/availability'

/**
 * Public companion reads.
 *
 * Every query here runs on the anon client, so RLS is what hides inactive
 * companions and unpublished reviews — not a `.eq('is_active', true)` that a
 * future refactor could quietly drop. companion_identities is never touched.
 */

export type CompanionCard = {
  id: string
  slug: string
  displayName: string
  bio: string | null
  photoUrl: string | null
  hourlyRatePaise: number
  isAccepting: boolean
  areas: string[]
  /** Ordered to match `areas`. Needed to create a hold and to offer the area picker. */
  areaIds: string[]
  reviewCount: number
  averageRating: number | null
}

export type CompanionProfile = CompanionCard & {
  rules: { weekday: number; start_time: string; end_time: string }[]
  reviews: {
    id: string
    rating: number
    body: string | null
    createdAt: string
  }[]
}

export function photoUrl(path: string | null): string | null {
  if (!path) return null
  if (path.startsWith('http')) return path
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return null
  return `${base}/storage/v1/object/public/companion-photos/${path}`
}

function toCard(row: any): CompanionCard {
  const ratings: number[] = (row.reviews ?? []).map((r: any) => r.rating)
  const sortedAreas = (row.companion_areas ?? [])
    .map((ca: any) => ca.areas)
    .filter(Boolean)
    .sort((a: any, b: any) => a.sort_order - b.sort_order)
  const areas: string[] = sortedAreas.map((a: any) => a.name)
  const areaIds: string[] = sortedAreas.map((a: any) => a.id)

  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    bio: row.bio,
    photoUrl: photoUrl(row.photo_path),
    hourlyRatePaise: row.hourly_rate_paise,
    isAccepting: row.is_accepting,
    areas,
    areaIds,
    reviewCount: ratings.length,
    averageRating: ratings.length
      ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
      : null,
  }
}

export const listCompanions = cache(async (): Promise<CompanionCard[]> => {
  const supabase = createPublicClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('companions')
    .select(
      `id, slug, display_name, bio, photo_path, hourly_rate_paise, is_accepting,
       companion_areas ( areas ( id, name, sort_order ) ),
       reviews ( rating )`,
    )
    .order('created_at', { ascending: true })

  if (error || !data) return []
  return (data as any[]).map(toCard)
})

export const getCompanion = cache(
  async (slug: string): Promise<CompanionProfile | null> => {
    const supabase = createPublicClient()
    if (!supabase) return null

    const { data, error } = await supabase
      .from('companions')
      .select(
        `id, slug, display_name, bio, photo_path, hourly_rate_paise, is_accepting,
         companion_areas ( areas ( id, name, sort_order ) ),
         companion_availability ( weekday, start_time, end_time ),
         reviews ( id, rating, body, created_at )`,
      )
      .eq('slug', slug)
      .maybeSingle()

    // RLS returns nothing for an inactive companion, which is what makes the
    // profile 404 rather than render (PRD §6.1).
    if (error || !data) return null

    const row = data as any

    return {
      ...toCard(row),
      rules: (row.companion_availability ?? []).map((r: any) => ({
        weekday: r.weekday,
        start_time: String(r.start_time).slice(0, 5),
        end_time: String(r.end_time).slice(0, 5),
      })),
      // Only published reviews come back; RLS enforces that, not this code.
      reviews: (row.reviews ?? [])
        .sort(
          (a: any, b: any) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )
        .map((r: any) => ({
          id: r.id,
          rating: r.rating,
          body: r.body,
          createdAt: r.created_at,
        })),
    }
  },
)

export const listAreas = cache(
  async (): Promise<{ id: string; name: string }[]> => {
    const supabase = createPublicClient()
    if (!supabase) return []

    const { data } = await supabase
      .from('areas')
      .select('id, name')
      .order('sort_order', { ascending: true })
    return data ?? []
  },
)

/**
 * Availability for the picker.
 *
 * The RPC returns bare windows; the maths is done by the pure engine so it can
 * be unit tested without a database (CLAUDE.md §4).
 */
export async function getAvailability(
  companionId: string,
  opts: { durationMinutes: number; now?: Date; stepMinutes?: number },
): Promise<DayAvailability[]> {
  const supabase = createPublicClient()
  if (!supabase) return []

  const settings = await getSettings()
  const now = opts.now ?? new Date()
  const to = new Date(now.getTime() + (settings.bookingWindowDays + 1) * 86_400_000)

  const { data, error } = await supabase.rpc('get_availability_inputs', {
    p_companion_id: companionId,
    p_from: now.toISOString(),
    p_to: to.toISOString(),
  })

  if (error || !data) return []

  return computeAvailability(data as unknown as AvailabilityInputs, {
    now,
    durationMinutes: opts.durationMinutes,
    bufferMinutes: settings.bufferMinutes,
    serviceHours: settings.serviceHours,
    bookingWindowDays: settings.bookingWindowDays,
    timeZone: settings.timezone,
    stepMinutes: opts.stepMinutes ?? 60,
  })
}

export type DigestDay = {
  /** 'YYYY-MM-DD' in IST. */
  date: string
  /** 'TODAY', 'FRI', … */
  weekday: string
  dayOfMonth: string
  freeCount: number
  /** Distinct free start times across every accepting companion. */
  times: { value: string; label: string; free: boolean }[]
}

/**
 * The landing hero's live strip: which hours have at least one companion free,
 * across the whole roster.
 *
 * Runs at revalidation, not per request, so the cost is one RPC per accepting
 * companion every five minutes rather than on every visit.
 */
export async function getAvailabilityDigest(
  companions: CompanionCard[],
  opts: { durationMinutes: number; now?: Date; days?: number } = {
    durationMinutes: 60,
  },
): Promise<DigestDay[]> {
  const now = opts.now ?? new Date()
  const { formatSlotLabel, zonedParts } = await import('@/lib/time/zone')
  const settings = await getSettings()

  const perCompanion = await Promise.all(
    companions.map((c) =>
      getAvailability(c.id, { durationMinutes: opts.durationMinutes, now }),
    ),
  )

  // date -> start ISO -> free anywhere
  const byDate = new Map<string, Map<string, boolean>>()
  for (const days of perCompanion) {
    for (const day of days) {
      const slots = byDate.get(day.date) ?? new Map<string, boolean>()
      for (const slot of day.slots) {
        const key = slot.startsAt.toISOString()
        slots.set(key, (slots.get(key) ?? false) || slot.available)
      }
      byDate.set(day.date, slots)
    }
  }

  const todayKey = (await import('@/lib/time/zone')).zonedDateKey(now, settings.timezone)
  const limit = opts.days ?? 5

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, limit)
    .map(([date, slots]) => {
      const parts = zonedParts(new Date(`${date}T12:00:00+05:30`), settings.timezone)
      const names = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
      const times = [...slots.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([iso, free]) => ({
          value: iso,
          label: formatSlotLabel(new Date(iso), settings.timezone),
          free,
        }))

      return {
        date,
        weekday: date === todayKey ? 'TODAY' : names[parts.weekday],
        dayOfMonth: String(parts.day),
        freeCount: times.filter((t) => t.free).length,
        times,
      }
    })
}

/** 'Wed–Sun, 2–10pm' — the usual-hours summary on the profile. */
export function summariseRules(
  rules: { weekday: number; start_time: string; end_time: string }[],
): string | null {
  if (rules.length === 0) return null

  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const days = [...new Set(rules.map((r) => r.weekday))].sort((a, b) => a - b)

  const earliest = rules.reduce((m, r) => (r.start_time < m ? r.start_time : m), '23:59')
  const latest = rules.reduce((m, r) => (r.end_time > m ? r.end_time : m), '00:00')

  const contiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1)
  const dayLabel =
    days.length === 7
      ? 'Every day'
      : contiguous && days.length > 2
        ? `${names[days[0]]}–${names[days[days.length - 1]]}`
        : days.map((d) => names[d]).join(', ')

  return `${dayLabel}, ${clock(earliest)}–${clock(latest)}`
}

function clock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h >= 12 ? 'pm' : 'am'
  const hour = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, '0')}${suffix}`
}
