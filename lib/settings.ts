import { cache } from 'react'
import { createPublicClient } from '@/lib/supabase/public'
import type { DurationDiscount } from '@/lib/booking/pricing'

/**
 * Runtime configuration. CLAUDE.md §3.10 — refund tiers, buffer, hold duration
 * and the booking window come from the settings table, never from a constant in
 * the code. The defaults here exist so a missing row degrades to the documented
 * business rule rather than to zero.
 */

export type RefundTier = {
  min_hours_before: number
  percent: number
  code: string
}

export type Settings = {
  bookingWindowDays: number
  bufferMinutes: number
  minDurationMinutes: number
  holdMinutes: number
  serviceHours: { start: string; end: string }
  timezone: string
  durationDiscounts: DurationDiscount[]
  refundTiers: RefundTier[]
  termsVersion: string
  confirmationSlaMinutes: number
  grievanceContact: { name: string; email: string }
}

export const SETTINGS_DEFAULTS: Settings = {
  bookingWindowDays: 7,
  bufferMinutes: 15,
  minDurationMinutes: 60,
  holdMinutes: 10,
  serviceHours: { start: '08:00', end: '22:00' },
  timezone: 'Asia/Kolkata',
  durationDiscounts: [
    { min_minutes: 180, percent: 30 },
    { min_minutes: 120, percent: 10 },
    { min_minutes: 60, percent: 0 },
  ],
  refundTiers: [
    { min_hours_before: 48, percent: 100, code: '48h_full' },
    { min_hours_before: 24, percent: 50, code: '24h_half' },
    { min_hours_before: 0, percent: 0, code: 'under_24h_none' },
  ],
  termsVersion: '2026-08-01',
  confirmationSlaMinutes: 15,
  grievanceContact: { name: 'Grievance Officer', email: 'privacy@alongco.com' },
}

/** Deduplicated per request. */
export const getSettings = cache(async (): Promise<Settings> => {
  try {
    const supabase = createPublicClient()
    if (!supabase) return SETTINGS_DEFAULTS

    const { data, error } = await supabase.from('settings').select('key, value')
    if (error || !data) return SETTINGS_DEFAULTS

    const map = new Map(data.map((r) => [r.key, r.value]))
    const read = <T>(key: string, fallback: T): T =>
      map.has(key) ? (map.get(key) as T) : fallback

    return {
      bookingWindowDays: read('booking_window_days', SETTINGS_DEFAULTS.bookingWindowDays),
      bufferMinutes: read('buffer_minutes', SETTINGS_DEFAULTS.bufferMinutes),
      minDurationMinutes: read('min_duration_minutes', SETTINGS_DEFAULTS.minDurationMinutes),
      holdMinutes: read('hold_minutes', SETTINGS_DEFAULTS.holdMinutes),
      serviceHours: read('service_hours', SETTINGS_DEFAULTS.serviceHours),
      timezone: read('timezone', SETTINGS_DEFAULTS.timezone),
      durationDiscounts: read('duration_discounts', SETTINGS_DEFAULTS.durationDiscounts),
      refundTiers: read('refund_tiers', SETTINGS_DEFAULTS.refundTiers),
      termsVersion: read('terms_version', SETTINGS_DEFAULTS.termsVersion),
      confirmationSlaMinutes: read(
        'confirmation_sla_minutes',
        SETTINGS_DEFAULTS.confirmationSlaMinutes,
      ),
      grievanceContact: read('grievance_contact', SETTINGS_DEFAULTS.grievanceContact),
    }
  } catch {
    // Env not wired yet. The public pages still need to render.
    return SETTINGS_DEFAULTS
  }
})

/** Durations the picker offers, derived from the discount tiers. */
export function offeredDurations(settings: Settings): number[] {
  const base = settings.minDurationMinutes
  return [base, base * 2, base * 3]
}
