'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { getBookingByReference } from '@/lib/booking/queries'

/**
 * Review submission. PRD §6.10.
 *
 * No auth required. The booking reference is the access token. We check in the
 * database that the booking is `completed` and has already ended using RLS on
 * the reviews table.
 */

export type ReviewFormState = { error?: string; ok?: string }

const schema = z.object({
  reference: z.string().min(1),
  bookingId: z.string().uuid(),
  rating: z.coerce.number().int().min(1, 'Pick a rating.').max(5),
  body: z.string().trim().max(1500, 'Keep it under 1500 characters.').optional(),
})

export async function submitReview(
  _prev: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const parsed = schema.safeParse({
    reference: formData.get('reference'),
    bookingId: formData.get('bookingId'),
    rating: formData.get('rating'),
    body: formData.get('body') || undefined,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  }

  const { reference, bookingId, rating, body } = parsed.data

  // Verify the reference matches the booking id (is the access token)
  const booking = await getBookingByReference(reference)
  if (!booking || booking.id !== bookingId) {
    return { error: 'We cannot find that booking.' }
  }

  // Check eligibility
  if (booking.status !== 'completed') {
    return {
      error:
        'Only a completed booking can be reviewed. A cancelled booking, or one that ended early, cannot.',
    }
  }
  if (new Date(booking.endsAt).getTime() > Date.now()) {
    return { error: 'This booking has not finished yet.' }
  }

  // Look up the companion UUID — bookingView.companionSlug is a string, not a UUID.
  // Service-role reads the companion id directly from the booking row via the query layer.
  const supabase = createServiceClient()
  const { data: bookingRow } = await supabase
    .from('bookings')
    .select('companion_id, customer_id')
    .eq('id', bookingId)
    .single()

  if (!bookingRow) return { error: 'We cannot find that booking.' }

  const { error } = await supabase.from('reviews').insert({
    booking_id: bookingId,
    companion_id: bookingRow.companion_id,
    customer_id: bookingRow.customer_id,
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

  revalidatePath(`/ticket/${reference}`)

  return {
    ok: 'Thank you. We read every review before it goes on his profile, so it will not appear straight away.',
  }
}
