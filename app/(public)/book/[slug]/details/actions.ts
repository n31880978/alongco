'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { bookingErrorMessage } from '@/lib/booking/errors'

export type DetailsState = { error?: string }

const schema = z.object({
  slug: z.string().min(1),
  bookingId: z.string().uuid(),
  fullName: z
    .string()
    .trim()
    .min(2, 'Please enter your full name.')
    .max(120, 'That name is too long.'),
  areaId: z.string().uuid('Choose where you want to meet.'),
  notes: z.string().trim().max(500, 'Please keep this under 500 characters.').optional(),
  consent: z.literal('on', {
    errorMap: () => ({ message: 'Please agree before continuing.' }),
  }),
})

/**
 * Writes the name and meeting area onto the held booking.
 *
 * Goes through ac_set_booking_details rather than an update, because bookings
 * has no UPDATE policy and the area has to be re-validated against the
 * companion's own areas server-side (CLAUDE.md §3.9).
 */
export async function saveDetails(
  _prev: DetailsState,
  formData: FormData,
): Promise<DetailsState> {
  const parsed = schema.safeParse({
    slug: formData.get('slug'),
    bookingId: formData.get('bookingId'),
    fullName: formData.get('fullName'),
    areaId: formData.get('areaId'),
    notes: formData.get('notes') ?? undefined,
    consent: formData.get('consent'),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' }
  }

  const { slug, bookingId, fullName, areaId, notes } = parsed.data
  const supabase = await createClient()

  const { error } = await supabase.rpc('ac_set_booking_details', {
    p_booking_id: bookingId,
    p_full_name: fullName,
    p_area_id: areaId,
    p_notes: notes ?? null,
  })

  if (error) return { error: bookingErrorMessage(error) }

  redirect(`/book/${slug}/pay?b=${bookingId}`)
}
