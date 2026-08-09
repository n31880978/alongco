'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { getSettings } from '@/lib/settings'
import { bookingErrorMessage, shouldRefreshSlots } from '@/lib/booking/errors'
import { allowPublicBookingAttempt } from '@/lib/auth/rate-limit'

/**
 * Creating the hold. CLAUDE.md §3.1 and §3.9.
 *
 * No auth. The form collects the customer's real name, email, phone,
 * preferences and notes. The RPC creates (or updates) the customer row by
 * email and creates the booking hold in a single transaction.
 *
 * What is NOT sent: a price. The RPC computes it from the companion's stored
 * rate — there is no price field on this form to forge.
 */

export type HoldState = {
  error?: string
  /** Slot grid is stale — trigger a page refresh. */
  refresh?: boolean
}

const holdSchema = z.object({
  slug:            z.string().min(1),
  startsAt:        z.string().datetime({ offset: true }),
  durationMinutes: z.coerce.number().int().positive(),
  areaId:          z.string().uuid(),
  // Customer details
  fullName:  z.string().trim().min(2, 'Enter your full name.').max(120),
  email:     z.string().trim().email('Enter a valid email address.'),
  phone:     z
    .string()
    .trim()
    .transform((v) => v.replace(/[^\d]/g, ''))
    .refine((v) => /^(91)?[6-9]\d{9}$/.test(v), {
      message: 'Enter a 10-digit Indian mobile number.',
    })
    .transform((v) => (v.length === 10 ? `91${v}` : v)),
  preferences:   z.string().trim().max(500).optional(),
  customerNotes: z.string().trim().max(500).optional(),
})

export async function holdSlot(_prev: HoldState, formData: FormData): Promise<HoldState> {
  const parsed = holdSchema.safeParse({
    slug:            formData.get('slug'),
    startsAt:        formData.get('startsAt'),
    durationMinutes: formData.get('durationMinutes'),
    areaId:          formData.get('areaId'),
    fullName:        formData.get('fullName'),
    email:           formData.get('email'),
    phone:           formData.get('phone'),
    preferences:     formData.get('preferences') ?? undefined,
    customerNotes:   formData.get('customerNotes') ?? undefined,
  })

  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? 'Check the form and try again.' }
  }

  const {
    slug, startsAt, durationMinutes, areaId,
    fullName, email, phone, preferences, customerNotes,
  } = parsed.data

  try {
    if (!(await allowPublicBookingAttempt(email))) {
      return { error: 'Too many attempts from your device. Please wait a few minutes and try again.' }
    }
  } catch {
    // Rate-limit infrastructure failure: fail open so a transient DB issue
    // does not block all bookings. The limit is defence-in-depth, not the
    // only safeguard.
    // (intentional no-op — proceed)
  }

  const settings = await getSettings()
  const supabase = createServiceClient()

  const { data, error } = await supabase.rpc('create_booking_hold', {
    p_companion_slug:   slug,
    p_starts_at:        startsAt,
    p_duration_minutes: durationMinutes,
    p_area_id:          areaId,
    p_terms_version:    settings.termsVersion,
    p_full_name:        fullName,
    p_email:            email,
    p_phone:            phone,
    p_preferences:      preferences ?? null,
    p_customer_notes:   customerNotes ?? null,
  })

  if (error) {
    return { error: bookingErrorMessage(error), refresh: shouldRefreshSlots(error) }
  }

  const result = data as unknown as { booking_id: string }
  redirect(`/book/${slug}/pay?b=${result.booking_id}`)
}
