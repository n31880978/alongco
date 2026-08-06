'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentCustomer } from '@/lib/auth/session'
import { checkActionRateLimit } from '@/lib/auth/rate-limit'

/**
 * Review submission. PRD §6.10.
 *
 * Deliberately on the *user's* client, not the service client: the insert is
 * allowed only by reviews_insert_own, which checks in the database that the
 * booking belongs to the caller, is `completed`, and has already ended. The
 * eligibility rule is therefore enforced by RLS rather than by this function
 * agreeing to be careful.
 */

export type ReviewFormState = { error?: string; ok?: string }

const schema = z.object({
  bookingId: z.string().uuid(),
  rating: z.coerce.number().int().min(1, 'Pick a rating.').max(5),
  body: z.string().trim().max(1500, 'Keep it under 1500 characters.').optional(),
})

export async function submitReview(
  _prev: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const customer = await getCurrentCustomer()
  if (!customer) return { error: 'Sign in again to leave a review.' }

  const parsed = schema.safeParse({
    bookingId: formData.get('bookingId'),
    rating: formData.get('rating'),
    body: formData.get('body') || undefined,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  }

  const { bookingId, rating, body } = parsed.data

  // T21.
  const limit = await checkActionRateLimit('review', customer.id)
  if (!limit.ok) return { error: limit.reason }

  const supabase = await createClient()

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, companion_id, status, ends_at, reference')
    .eq('id', bookingId)
    .maybeSingle()

  if (!booking) return { error: 'We cannot find that booking.' }

  const b = booking as { companion_id: string; status: string; ends_at: string; reference: string }

  // Checked here as well so the message is specific rather than a bare RLS
  // rejection — she should know *why* she cannot review it.
  if (b.status !== 'completed') {
    return {
      error:
        'Only a completed booking can be reviewed. A cancelled booking, or one that ended early, cannot.',
    }
  }
  if (new Date(b.ends_at).getTime() > Date.now()) {
    return { error: 'This booking has not finished yet.' }
  }

  const { error } = await supabase.from('reviews').insert({
    booking_id: bookingId,
    customer_id: customer.id,
    companion_id: b.companion_id,
    rating,
    body: body || null,
    is_published: false,
  })

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return { error: 'You have already reviewed this booking.' }
    }
    return {
      error:
        'The review could not be saved. Nothing was recorded — you can try again.',
    }
  }

  revalidatePath('/bookings')
  revalidatePath(`/review/${b.reference}`)

  return {
    ok: 'Thank you. We read every review before it goes on his profile, so it will not appear straight away.',
  }
}
