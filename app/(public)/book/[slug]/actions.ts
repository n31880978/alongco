'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { createCustomerClient } from '@/lib/supabase/customer'
import { getCurrentCustomer } from '@/lib/auth/session'
import { checkActionRateLimit } from '@/lib/auth/rate-limit'
import { getSettings } from '@/lib/settings'
import { bookingErrorMessage, shouldRefreshSlots } from '@/lib/booking/errors'

/**
 * Creating the hold. CLAUDE.md §3.1 and §3.9.
 *
 * Note what this does NOT send: an amount. The RPC computes the price from the
 * companion's current rate and snapshots it. A forged price in the request body
 * has nowhere to go, because there is no price field to forge.
 */

export type HoldState = {
  error?: string
  /** The slot list on screen is stale — the page refetches when this is set. */
  refresh?: boolean
}

const holdSchema = z.object({
  slug: z.string().min(1),
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z.coerce.number().int().positive(),
  areaId: z.string().uuid(),
})

export async function holdSlot(_prev: HoldState, formData: FormData): Promise<HoldState> {
  const parsed = holdSchema.safeParse({
    slug: formData.get('slug'),
    startsAt: formData.get('startsAt'),
    durationMinutes: formData.get('durationMinutes'),
    areaId: formData.get('areaId'),
  })

  if (!parsed.success) {
    return { error: 'Pick a time before continuing.' }
  }

  const { slug, startsAt, durationMinutes, areaId } = parsed.data

  // Every hold must have an owner (PRD §6.3), so authentication comes first.
  // The selection rides along in `next` so she lands back on the same choice.
  const customer = await getCurrentCustomer()
  if (!customer) {
    const back = `/book/${slug}?m=${durationMinutes}&t=${encodeURIComponent(startsAt)}`
    redirect(`/sign-in?next=${encodeURIComponent(back)}`)
  }

  // T21. Holds take a companion's slot off the market for ten minutes, so
  // creating them in bulk without paying is the cheapest way to deny the whole
  // service. Checked after auth, keyed on her customer id.
  const limit = await checkActionRateLimit('booking_hold', customer.id)
  if (!limit.ok) return { error: limit.reason }

  const settings = await getSettings()
  const supabase = createCustomerClient()

  const { data, error } = await supabase.rpc('create_booking_hold', {
    p_companion_slug: slug,
    p_starts_at: startsAt,
    p_duration_minutes: durationMinutes,
    p_area_id: areaId,
    p_terms_version: settings.termsVersion,
    p_customer_notes: null,
  })

  if (error) {
    return { error: bookingErrorMessage(error), refresh: shouldRefreshSlots(error) }
  }

  const result = data as unknown as { booking_id: string }
  redirect(`/book/${slug}/details?b=${result.booking_id}`)
}
