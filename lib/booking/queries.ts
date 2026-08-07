import 'server-only'
import { cache } from 'react'
import { createCustomerClient } from '@/lib/supabase/customer'
import type { BookingStatus } from '@/lib/supabase/types'

/**
 * Customer-facing booking reads. All on the anon-key server client, so RLS is
 * what scopes them to the caller — never a `.eq('customer_id', …)` that a
 * refactor could drop.
 */

export type BookingView = {
  id: string
  reference: string
  status: BookingStatus
  startsAt: string
  endsAt: string
  amountPaise: number
  /** Rate at the time of booking. An admin rate change never re-prices this. */
  rateSnapshotPaise: number
  discountPercent: number
  holdExpiresAt: string | null
  termsVersion: string
  termsAcceptedAt: string
  customerNotes: string | null
  areaId: string
  areaName: string
  companionSlug: string
  companionName: string
  companionPhotoPath: string | null
  confirmedAt: string | null
  cancelledAt: string | null
  refundTierApplied: string | null
  paymentMethod: string | null
}

const SELECT = `
  id, reference, status, starts_at, ends_at, amount_paise, rate_snapshot_paise,
  discount_percent,
  hold_expires_at, terms_version, terms_accepted_at, customer_notes, area_id,
  confirmed_at, cancelled_at, refund_tier_applied,
  areas ( name ),
  companions ( slug, display_name, photo_path ),
  payments ( method, status )
`

function shape(row: any): BookingView {
  const captured = (row.payments ?? []).find((p: any) => p.status === 'captured')
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    amountPaise: row.amount_paise,
    rateSnapshotPaise: row.rate_snapshot_paise,
    discountPercent: row.discount_percent,
    holdExpiresAt: row.hold_expires_at,
    termsVersion: row.terms_version,
    termsAcceptedAt: row.terms_accepted_at,
    customerNotes: row.customer_notes,
    areaId: row.area_id,
    areaName: row.areas?.name ?? '',
    companionSlug: row.companions?.slug ?? '',
    // Pseudonym only. The real name is in companion_identities and is never
    // joined into anything a client can reach (CLAUDE.md §3.6).
    companionName: row.companions?.display_name ?? '',
    companionPhotoPath: row.companions?.photo_path ?? null,
    confirmedAt: row.confirmed_at,
    cancelledAt: row.cancelled_at,
    refundTierApplied: row.refund_tier_applied,
    paymentMethod: captured?.method ?? null,
  }
}

export const getOwnBooking = cache(async (id: string): Promise<BookingView | null> => {
  const supabase = createCustomerClient()
  const { data, error } = await supabase
    .from('bookings')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return shape(data)
})

/**
 * By reference, for the ticket URL. RLS makes another customer's reference a
 * miss rather than a leak, which is the 404 in PRD §6.7.
 */
export const getOwnBookingByReference = cache(
  async (reference: string): Promise<BookingView | null> => {
    const supabase = createCustomerClient()
    const { data, error } = await supabase
      .from('bookings')
      .select(SELECT)
      .eq('reference', reference.toUpperCase())
      .maybeSingle()
    if (error || !data) return null
    return shape(data)
  },
)

export const listOwnBookings = cache(async (): Promise<BookingView[]> => {
  const supabase = createCustomerClient()
  const { data, error } = await supabase
    .from('bookings')
    .select(SELECT)
    .order('starts_at', { ascending: false })
  if (error || !data) return []
  return (data as any[]).map(shape)
})

export function isHoldLive(booking: BookingView, now = new Date()): boolean {
  return (
    booking.status === 'pending_payment' &&
    booking.holdExpiresAt !== null &&
    new Date(booking.holdExpiresAt).getTime() > now.getTime()
  )
}
