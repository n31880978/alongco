import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import type { BookingStatus } from '@/lib/supabase/types'

/**
 * Booking reads.
 *
 * No customer session — bookings are looked up by reference (the ticket number)
 * or by booking id. The reference is the access token: anyone who has it may
 * see it, which is correct — the QR code on the ticket is shared with the
 * companion.
 *
 * All reads use the service client so they work regardless of auth state.
 * RLS enforcement for customer data happens at the RPC layer (security definer
 * functions), not at the query layer.
 */

export type BookingView = {
  id: string
  reference: string
  status: BookingStatus
  startsAt: string
  endsAt: string
  amountPaise: number
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
  // Customer info — shown on ticket and in pay prefill
  customerFullName: string | null
  customerEmail: string | null
  customerPhone: string | null
}

const SELECT = `
  id, reference, status, starts_at, ends_at, amount_paise, rate_snapshot_paise,
  discount_percent, hold_expires_at, terms_version, terms_accepted_at,
  customer_notes, area_id, confirmed_at, cancelled_at, refund_tier_applied,
  areas ( name ),
  companions ( slug, display_name, photo_path ),
  payments ( method, status ),
  customers ( full_name, email, phone )
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
    companionName: row.companions?.display_name ?? '',
    companionPhotoPath: row.companions?.photo_path ?? null,
    confirmedAt: row.confirmed_at,
    cancelledAt: row.cancelled_at,
    refundTierApplied: row.refund_tier_applied,
    paymentMethod: captured?.method ?? null,
    customerFullName: row.customers?.full_name ?? null,
    customerEmail: row.customers?.email ?? null,
    customerPhone: row.customers?.phone ?? null,
  }
}

export async function getBookingById(id: string): Promise<BookingView | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('bookings')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return shape(data)
}

/** Confirms a Razorpay order was created for this booking before trusting a signed browser return. */
export async function bookingHasPaymentOrder(bookingId: string, orderId: string): Promise<boolean> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('payments')
    .select('id')
    .eq('booking_id', bookingId)
    .eq('payment_provider', 'razorpay')
    .eq('provider_order_id', orderId)
    .maybeSingle()
  return !error && Boolean(data)
}

/** By reference — the ticket URL. The reference is the access token. */
export async function getBookingByReference(reference: string): Promise<BookingView | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('bookings')
    .select(SELECT)
    .eq('reference', reference.toUpperCase())
    .maybeSingle()
  if (error || !data) return null
  return shape(data)
}

/**
 * Public booking lookup by reference — returns minimal info.
 * Used for unauthenticated ticket lookup on the homepage.
 * Returns only: reference, status, slot time, companion name, no customer PII.
 */
export type PublicBookingLookup = {
  reference: string
  status: BookingStatus
  startsAt: string
  endsAt: string
  companionName: string
  companionPhotoPath: string | null
  areaName: string
  isHoldLive: boolean
}

export async function getBookingByReferencePublic(
  reference: string
): Promise<PublicBookingLookup | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('bookings')
    .select(
      `reference, status, starts_at, ends_at, hold_expires_at,
       companions ( display_name, photo_path ),
       areas ( name )`
    )
    .eq('reference', reference.toUpperCase())
    .maybeSingle()

  if (error || !data) return null

  const row = data as any

  const isHoldLive =
    row.status === 'pending_payment' &&
    row.hold_expires_at !== null &&
    new Date(row.hold_expires_at).getTime() > Date.now()

  return {
    reference: row.reference,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    companionName: row.companions?.display_name ?? '',
    companionPhotoPath: row.companions?.photo_path ?? null,
    areaName: row.areas?.name ?? '',
    isHoldLive,
  }
}

export function isHoldLive(booking: BookingView, now = new Date()): boolean {
  return (
    booking.status === 'pending_payment' &&
    booking.holdExpiresAt !== null &&
    new Date(booking.holdExpiresAt).getTime() > now.getTime()
  )
}

// Legacy aliases — keep so other files still compile during migration.
export const getOwnBooking = getBookingById
export const getOwnBookingByReference = getBookingByReference
export const listOwnBookings = async () => []
