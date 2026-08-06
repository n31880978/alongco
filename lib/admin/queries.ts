import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import type {
  BookingStatus,
  IncidentStatus,
  IncidentType,
  PaymentStatus,
  RefundStatus,
} from '@/lib/supabase/types'

/**
 * Admin reads, on the service client.
 *
 * Callers must have gone through requireAdmin() first — this module trusts that
 * and does no checking of its own, so never import it from a public page.
 */

export type AdminCompanionRow = {
  id: string
  slug: string
  displayName: string
  hourlyRatePaise: number
  isActive: boolean
  isAccepting: boolean
  areas: { id: string; name: string }[]
  hasIdentity: boolean
  upcomingCount: number
}

export async function listAdminCompanions(): Promise<AdminCompanionRow[]> {
  const service = createServiceClient()
  const { data } = await service
    .from('companions')
    .select(
      `id, slug, display_name, hourly_rate_paise, is_active, is_accepting,
       companion_areas ( areas ( id, name, sort_order ) ),
       companion_identities ( companion_id ),
       bookings ( id, status, starts_at )`,
    )
    .order('created_at', { ascending: true })

  const now = Date.now()
  return ((data as any[]) ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    hourlyRatePaise: row.hourly_rate_paise,
    isActive: row.is_active,
    isAccepting: row.is_accepting,
    areas: (row.companion_areas ?? [])
      .map((ca: any) => ca.areas)
      .filter(Boolean)
      .sort((a: any, b: any) => a.sort_order - b.sort_order)
      .map((a: any) => ({ id: a.id, name: a.name })),
    hasIdentity: Boolean(row.companion_identities),
    upcomingCount: (row.bookings ?? []).filter(
      (b: any) =>
        b.status === 'confirmed' && new Date(b.starts_at).getTime() >= now,
    ).length,
  }))
}

export type AdminCompanionDetail = AdminCompanionRow & {
  bio: string | null
  photoPath: string | null
  rules: { id: string; weekday: number; startTime: string; endTime: string }[]
  blackouts: { id: string; startsAt: string; endsAt: string; reason: string | null }[]
}

export async function getAdminCompanion(
  id: string,
): Promise<AdminCompanionDetail | null> {
  const service = createServiceClient()
  const { data } = await service
    .from('companions')
    .select(
      `id, slug, display_name, bio, photo_path, hourly_rate_paise, is_active, is_accepting,
       companion_areas ( areas ( id, name, sort_order ) ),
       companion_identities ( companion_id ),
       companion_availability ( id, weekday, start_time, end_time ),
       companion_blackouts ( id, starts_at, ends_at, reason ),
       bookings ( id, status, starts_at )`,
    )
    .eq('id', id)
    .maybeSingle()

  if (!data) return null
  const row = data as any
  const now = Date.now()

  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    bio: row.bio,
    photoPath: row.photo_path,
    hourlyRatePaise: row.hourly_rate_paise,
    isActive: row.is_active,
    isAccepting: row.is_accepting,
    areas: (row.companion_areas ?? [])
      .map((ca: any) => ca.areas)
      .filter(Boolean)
      .sort((a: any, b: any) => a.sort_order - b.sort_order)
      .map((a: any) => ({ id: a.id, name: a.name })),
    hasIdentity: Boolean(row.companion_identities),
    upcomingCount: (row.bookings ?? []).filter(
      (b: any) => b.status === 'confirmed' && new Date(b.starts_at).getTime() >= now,
    ).length,
    rules: (row.companion_availability ?? [])
      .map((r: any) => ({
        id: r.id,
        weekday: r.weekday,
        startTime: String(r.start_time).slice(0, 5),
        endTime: String(r.end_time).slice(0, 5),
      }))
      .sort((a: any, b: any) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime)),
    blackouts: (row.companion_blackouts ?? [])
      .map((b: any) => ({
        id: b.id,
        startsAt: b.starts_at,
        endsAt: b.ends_at,
        reason: b.reason,
      }))
      .sort((a: any, b: any) => a.startsAt.localeCompare(b.startsAt)),
  }
}

/** Owner-role callers only. CLAUDE.md §3.6. */
export async function getCompanionIdentity(companionId: string) {
  const service = createServiceClient()
  const { data } = await service
    .from('companion_identities')
    .select('*')
    .eq('companion_id', companionId)
    .maybeSingle()
  return data
}

export async function listAdminAreas() {
  const service = createServiceClient()
  const { data } = await service
    .from('areas')
    .select('id, name')
    .order('sort_order', { ascending: true })
  return data ?? []
}

// --- confirmation queue (PRD §6.8) -------------------------------------------

export type ConfirmationRow = {
  bookingId: string
  reference: string
  startsAt: string
  endsAt: string
  areaName: string
  amountPaise: number
  companionName: string
  customerFirstName: string
  customerPhone: string
  customerNotes: string | null
  confirmedAt: string | null
  confirmationSentAt: string | null
  minutesWaiting: number
}

/**
 * Newly confirmed bookings awaiting a manual WhatsApp message.
 *
 * This is the one place a customer's phone number is deliberately shown — the
 * admin needs it to open wa.me. It is never logged and never leaves the page.
 */
export async function listConfirmationQueue(
  opts: { includeSent?: boolean } = {},
): Promise<ConfirmationRow[]> {
  const service = createServiceClient()
  let query = service
    .from('bookings')
    .select(
      `id, reference, starts_at, ends_at, amount_paise, customer_notes,
       confirmed_at, confirmation_sent_at,
       areas ( name ),
       companions ( display_name ),
       customers ( full_name, phone )`,
    )
    .eq('status', 'confirmed')
    .order('confirmed_at', { ascending: true })

  if (!opts.includeSent) query = query.is('confirmation_sent_at', null)

  const { data } = await query
  const now = Date.now()

  return ((data as any[]) ?? []).map((row) => ({
    bookingId: row.id,
    reference: row.reference,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    areaName: row.areas?.name ?? '',
    amountPaise: row.amount_paise,
    companionName: row.companions?.display_name ?? '',
    customerFirstName: (row.customers?.full_name ?? '').trim().split(/\s+/)[0] || '—',
    customerPhone: row.customers?.phone ?? '',
    customerNotes: row.customer_notes,
    confirmedAt: row.confirmed_at,
    confirmationSentAt: row.confirmation_sent_at,
    minutesWaiting: row.confirmed_at
      ? Math.floor((now - new Date(row.confirmed_at).getTime()) / 60000)
      : 0,
  }))
}

export type AdminBookingRow = {
  id: string
  reference: string
  status: BookingStatus
  startsAt: string
  endsAt: string
  amountPaise: number
  companionName: string
  customerFirstName: string
  areaName: string
  confirmationSentAt: string | null
}

export async function listAdminBookings(
  filter: { status?: BookingStatus; search?: string } = {},
): Promise<AdminBookingRow[]> {
  const service = createServiceClient()
  let query = service
    .from('bookings')
    .select(
      `id, reference, status, starts_at, ends_at, amount_paise, confirmation_sent_at,
       areas ( name ), companions ( display_name ), customers ( full_name )`,
    )
    .order('starts_at', { ascending: false })
    .limit(200)

  if (filter.status) query = query.eq('status', filter.status)
  if (filter.search) query = query.ilike('reference', `%${filter.search.toUpperCase()}%`)

  const { data } = await query
  return ((data as any[]) ?? []).map((row) => ({
    id: row.id,
    reference: row.reference,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    amountPaise: row.amount_paise,
    companionName: row.companions?.display_name ?? '',
    customerFirstName: (row.customers?.full_name ?? '').trim().split(/\s+/)[0] || '—',
    areaName: row.areas?.name ?? '',
    confirmationSentAt: row.confirmation_sent_at,
  }))
}

// --- booking detail (PRD §6.9, §6.11) ----------------------------------------

export type AdminBookingDetail = {
  id: string
  reference: string
  status: BookingStatus
  startsAt: string
  endsAt: string
  durationMinutes: number
  amountPaise: number
  discountPercent: number
  areaName: string
  companionId: string
  companionName: string
  customerId: string
  customerName: string
  customerPhone: string
  customerNotes: string | null
  termsVersion: string
  termsAcceptedAt: string
  confirmedAt: string | null
  confirmationSentAt: string | null
  cancelledAt: string | null
  cancellationReason: string | null
  refundTierApplied: string | null
  payment: {
    id: string
    cashfreeOrderId: string
    status: PaymentStatus
    amountPaise: number
    method: string | null
    capturedAt: string | null
  } | null
  refunds: {
    id: string
    amountPaise: number
    status: RefundStatus
    tierApplied: string | null
    createdAt: string
  }[]
  events: {
    id: string
    fromStatus: BookingStatus | null
    toStatus: BookingStatus
    actorType: string
    reason: string | null
    createdAt: string
  }[]
  incidents: { id: string; type: string; status: string; createdAt: string }[]
}

export async function getAdminBooking(id: string): Promise<AdminBookingDetail | null> {
  const service = createServiceClient()
  const { data } = await service
    .from('bookings')
    .select(
      `id, reference, status, starts_at, ends_at, amount_paise, discount_percent,
       customer_notes, terms_version, terms_accepted_at, confirmed_at,
       confirmation_sent_at, cancelled_at, cancellation_reason, refund_tier_applied,
       areas ( name ),
       companions ( id, display_name ),
       customers ( id, full_name, phone ),
       payments ( id, cashfree_order_id, status, amount_paise, method, captured_at ),
       refunds ( id, amount_paise, status, tier_applied, created_at ),
       booking_events ( id, from_status, to_status, actor_type, reason, created_at ),
       incidents ( id, type, status, created_at )`,
    )
    .eq('id', id)
    .maybeSingle()

  if (!data) return null
  const row = data as any

  // The captured payment is the one a refund goes against. There may be earlier
  // failed attempts on the same booking (PRD §6.6 retry), so pick deliberately.
  const payments = (row.payments ?? []) as any[]
  const captured =
    payments.find((p) => p.status === 'captured' || p.status === 'partially_refunded') ??
    payments.find((p) => p.status === 'refunded') ??
    null

  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    durationMinutes: Math.round(
      (new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60000,
    ),
    amountPaise: row.amount_paise,
    discountPercent: row.discount_percent ?? 0,
    areaName: row.areas?.name ?? '',
    companionId: row.companions?.id ?? '',
    companionName: row.companions?.display_name ?? '',
    customerId: row.customers?.id ?? '',
    customerName: row.customers?.full_name ?? '—',
    customerPhone: row.customers?.phone ?? '',
    customerNotes: row.customer_notes,
    termsVersion: row.terms_version,
    termsAcceptedAt: row.terms_accepted_at,
    confirmedAt: row.confirmed_at,
    confirmationSentAt: row.confirmation_sent_at,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    refundTierApplied: row.refund_tier_applied,
    payment: captured
      ? {
          id: captured.id,
          cashfreeOrderId: captured.cashfree_order_id,
          status: captured.status,
          amountPaise: captured.amount_paise,
          method: captured.method,
          capturedAt: captured.captured_at,
        }
      : null,
    refunds: ((row.refunds ?? []) as any[])
      .map((r) => ({
        id: r.id,
        amountPaise: r.amount_paise,
        status: r.status as RefundStatus,
        tierApplied: r.tier_applied,
        createdAt: r.created_at,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    events: ((row.booking_events ?? []) as any[])
      .map((e) => ({
        id: e.id,
        fromStatus: e.from_status,
        toStatus: e.to_status,
        actorType: e.actor_type,
        reason: e.reason,
        createdAt: e.created_at,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    incidents: ((row.incidents ?? []) as any[])
      .map((i) => ({ id: i.id, type: i.type, status: i.status, createdAt: i.created_at }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  }
}

/** What the cancel panel needs before it will show a refund figure. */
export async function getRefundQuote(
  bookingId: string,
  trigger: string,
): Promise<{ amountPaise: number; percent: number; tierCode: string } | null> {
  const service = createServiceClient()
  const { data, error } = await service.rpc('ac_refund_quote', {
    p_booking_id: bookingId,
    p_trigger: trigger,
  })
  if (error || !data) return null
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return null
  return {
    amountPaise: (row as any).amount_paise,
    percent: (row as any).percent,
    tierCode: (row as any).tier_code,
  }
}

// --- reviews (PRD §6.10) ------------------------------------------------------

export type AdminReviewRow = {
  id: string
  rating: number
  body: string | null
  isPublished: boolean
  moderatedAt: string | null
  moderationNote: string | null
  createdAt: string
  companionName: string
  customerFirstName: string
  bookingReference: string
  bookingStatus: BookingStatus
  /** A review on a booking with an open incident is never auto-published. */
  hasOpenIncident: boolean
}

export async function listAdminReviews(): Promise<AdminReviewRow[]> {
  const service = createServiceClient()
  const { data } = await service
    .from('reviews')
    .select(
      `id, rating, body, is_published, moderated_at, moderation_note, created_at,
       companions ( display_name ),
       customers ( full_name ),
       bookings ( reference, status, incidents ( id, status ) )`,
    )
    .order('created_at', { ascending: false })
    .limit(200)

  return ((data as any[]) ?? []).map((row) => ({
    id: row.id,
    rating: row.rating,
    body: row.body,
    isPublished: row.is_published,
    moderatedAt: row.moderated_at,
    moderationNote: row.moderation_note,
    createdAt: row.created_at,
    companionName: row.companions?.display_name ?? '',
    customerFirstName:
      (row.customers?.full_name ?? '').trim().split(/\s+/)[0] || '—',
    bookingReference: row.bookings?.reference ?? '',
    bookingStatus: row.bookings?.status,
    hasOpenIncident: ((row.bookings?.incidents ?? []) as any[]).some(
      (i) => i.status === 'open' || i.status === 'investigating',
    ),
  }))
}

// --- incidents (PRD §6.11) ----------------------------------------------------

export type AdminIncidentRow = {
  id: string
  type: IncidentType
  status: IncidentStatus
  reportedBy: string
  description: string
  actionTaken: string | null
  endedBooking: boolean
  refundIssued: boolean
  createdAt: string
  resolvedAt: string | null
  bookingId: string | null
  bookingReference: string | null
  companionName: string | null
  customerFirstName: string | null
}

export async function listAdminIncidents(): Promise<AdminIncidentRow[]> {
  const service = createServiceClient()
  const { data } = await service
    .from('incidents')
    .select(
      `id, type, status, reported_by, description, action_taken, ended_booking,
       refund_issued, created_at, resolved_at, booking_id,
       bookings ( reference ),
       companions ( display_name ),
       customers ( full_name )`,
    )
    .order('created_at', { ascending: false })
    .limit(200)

  return ((data as any[]) ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    reportedBy: row.reported_by,
    description: row.description,
    actionTaken: row.action_taken,
    endedBooking: row.ended_booking,
    refundIssued: row.refund_issued,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    bookingId: row.booking_id,
    bookingReference: row.bookings?.reference ?? null,
    companionName: row.companions?.display_name ?? null,
    customerFirstName: row.customers?.full_name
      ? String(row.customers.full_name).trim().split(/\s+/)[0]
      : null,
  }))
}

// --- customers (PRD §6.11) ----------------------------------------------------

export type AdminCustomerRow = {
  id: string
  fullName: string | null
  phone: string
  isBlocked: boolean
  blockReason: string | null
  deletionRequestedAt: string | null
  bookingCount: number
  lastBookingAt: string | null
}

export async function listAdminCustomers(
  search?: string,
): Promise<AdminCustomerRow[]> {
  const service = createServiceClient()
  let query = service
    .from('customers')
    .select(
      `id, full_name, phone, is_blocked, block_reason, deletion_requested_at,
       bookings ( id, starts_at, status )`,
    )
    .order('created_at', { ascending: false })
    .limit(200)

  if (search) {
    const term = search.trim()
    // Phone or name. Digits go to phone, anything else to name.
    query = /^[\d+\s-]+$/.test(term)
      ? query.ilike('phone', `%${term.replace(/[\s-]/g, '')}%`)
      : query.ilike('full_name', `%${term}%`)
  }

  const { data } = await query
  return ((data as any[]) ?? []).map((row) => {
    const paid = ((row.bookings ?? []) as any[]).filter(
      (b) => b.status !== 'expired' && b.status !== 'pending_payment',
    )
    return {
      id: row.id,
      fullName: row.full_name,
      phone: row.phone,
      isBlocked: row.is_blocked,
      blockReason: row.block_reason,
      deletionRequestedAt: row.deletion_requested_at,
      bookingCount: paid.length,
      lastBookingAt:
        paid.map((b) => b.starts_at).sort().reverse()[0] ?? null,
    }
  })
}

// --- payments reconciliation (PRD §6.11) -------------------------------------
//
// Read-only by decision: payouts to companions are settled manually outside the
// product, so this reconciles what Cashfree did and stops there. No "owed"
// figure is computed and no payout is recorded here.

export type PaymentsSummary = {
  capturedPaise: number
  refundedPaise: number
  netPaise: number
  bookingCount: number
  refundCount: number
  perCompanion: {
    companionId: string
    companionName: string
    hours: number
    completedCount: number
    grossPaise: number
  }[]
  recentRefunds: {
    id: string
    bookingReference: string
    amountPaise: number
    status: RefundStatus
    tierApplied: string | null
    createdAt: string
  }[]
}

export async function getPaymentsSummary(
  fromIso: string,
  toIso: string,
): Promise<PaymentsSummary> {
  const service = createServiceClient()

  const { data: payments } = await service
    .from('payments')
    .select('id, amount_paise, status, captured_at, bookings ( id )')
    .gte('captured_at', fromIso)
    .lt('captured_at', toIso)
    .in('status', ['captured', 'refunded', 'partially_refunded'])

  const { data: refunds } = await service
    .from('refunds')
    .select('id, amount_paise, status, tier_applied, created_at, bookings ( reference )')
    .gte('created_at', fromIso)
    .lt('created_at', toIso)
    .order('created_at', { ascending: false })

  // Hours actually delivered, per companion — the number a manual payout is
  // worked out from, without this product asserting what is owed.
  const { data: delivered } = await service
    .from('bookings')
    .select('id, starts_at, ends_at, amount_paise, companions ( id, display_name )')
    .eq('status', 'completed')
    .gte('starts_at', fromIso)
    .lt('starts_at', toIso)

  const capturedPaise = ((payments as any[]) ?? []).reduce(
    (sum, p) => sum + p.amount_paise,
    0,
  )
  const settledRefunds = ((refunds as any[]) ?? []).filter(
    (r) => r.status === 'success' || r.status === 'pending',
  )
  const refundedPaise = settledRefunds.reduce((sum, r) => sum + r.amount_paise, 0)

  const byCompanion = new Map<string, PaymentsSummary['perCompanion'][number]>()
  for (const b of ((delivered as any[]) ?? [])) {
    const id = b.companions?.id
    if (!id) continue
    const minutes =
      (new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60000
    const entry = byCompanion.get(id) ?? {
      companionId: id,
      companionName: b.companions.display_name,
      hours: 0,
      completedCount: 0,
      grossPaise: 0,
    }
    entry.hours += minutes / 60
    entry.completedCount += 1
    entry.grossPaise += b.amount_paise
    byCompanion.set(id, entry)
  }

  return {
    capturedPaise,
    refundedPaise,
    netPaise: capturedPaise - refundedPaise,
    bookingCount: ((payments as any[]) ?? []).length,
    refundCount: settledRefunds.length,
    perCompanion: [...byCompanion.values()].sort((a, b) => b.hours - a.hours),
    recentRefunds: ((refunds as any[]) ?? []).map((r) => ({
      id: r.id,
      bookingReference: r.bookings?.reference ?? '',
      amountPaise: r.amount_paise,
      status: r.status as RefundStatus,
      tierApplied: r.tier_applied,
      createdAt: r.created_at,
    })),
  }
}

// --- dashboard (PRD §6.11) ----------------------------------------------------

export type DashboardData = {
  todaysSchedule: {
    id: string
    reference: string
    startsAt: string
    endsAt: string
    status: BookingStatus
    companionName: string
    customerFirstName: string
    areaName: string
    confirmationSentAt: string | null
    isRunning: boolean
  }[]
  bookingsToday: number
  confirmedToday: number
  heldToday: number
  unsentCount: number
  overdueCount: number
  openIncidents: number
  pendingReviews: number
  weekRevenuePaise: number
  weekHours: number
  weekRefunds: number
}

export async function getDashboard(
  dayStartIso: string,
  dayEndIso: string,
  weekStartIso: string,
  slaMinutes: number,
): Promise<DashboardData> {
  const service = createServiceClient()

  const [{ data: today }, { data: unsent }, { data: incidents }, { data: reviews }, { data: weekPayments }, { data: weekBookings }, { data: weekRefunds }] =
    await Promise.all([
      service
        .from('bookings')
        .select(
          `id, reference, starts_at, ends_at, status, confirmation_sent_at,
           areas ( name ), companions ( display_name ), customers ( full_name )`,
        )
        .gte('starts_at', dayStartIso)
        .lt('starts_at', dayEndIso)
        .order('starts_at', { ascending: true }),
      service
        .from('bookings')
        .select('id, confirmed_at')
        .eq('status', 'confirmed')
        .is('confirmation_sent_at', null),
      service.from('incidents').select('id').in('status', ['open', 'investigating']),
      service.from('reviews').select('id').is('moderated_at', null),
      service
        .from('payments')
        .select('amount_paise')
        .gte('captured_at', weekStartIso)
        .in('status', ['captured', 'refunded', 'partially_refunded']),
      service
        .from('bookings')
        .select('starts_at, ends_at')
        .gte('starts_at', weekStartIso)
        .in('status', ['confirmed', 'completed']),
      service
        .from('refunds')
        .select('id')
        .gte('created_at', weekStartIso)
        .in('status', ['success', 'pending']),
    ])

  const now = Date.now()
  const rows = ((today as any[]) ?? []).map((row) => ({
    id: row.id,
    reference: row.reference,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status as BookingStatus,
    companionName: row.companions?.display_name ?? '',
    customerFirstName:
      (row.customers?.full_name ?? '').trim().split(/\s+/)[0] || '—',
    areaName: row.areas?.name ?? '',
    confirmationSentAt: row.confirmation_sent_at,
    isRunning:
      row.status === 'confirmed' &&
      new Date(row.starts_at).getTime() <= now &&
      new Date(row.ends_at).getTime() > now,
  }))

  const overdueCount = ((unsent as any[]) ?? []).filter(
    (b) =>
      b.confirmed_at &&
      now - new Date(b.confirmed_at).getTime() > slaMinutes * 60_000,
  ).length

  const weekMinutes = ((weekBookings as any[]) ?? []).reduce(
    (sum, b) =>
      sum + (new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60000,
    0,
  )

  return {
    todaysSchedule: rows,
    bookingsToday: rows.filter((r) => r.status !== 'expired').length,
    confirmedToday: rows.filter(
      (r) => r.status === 'confirmed' || r.status === 'completed',
    ).length,
    heldToday: rows.filter((r) => r.status === 'pending_payment').length,
    unsentCount: ((unsent as any[]) ?? []).length,
    overdueCount,
    openIncidents: ((incidents as any[]) ?? []).length,
    pendingReviews: ((reviews as any[]) ?? []).length,
    weekRevenuePaise: ((weekPayments as any[]) ?? []).reduce(
      (sum, p) => sum + p.amount_paise,
      0,
    ),
    weekHours: Math.round(weekMinutes / 60),
    weekRefunds: ((weekRefunds as any[]) ?? []).length,
  }
}

/**
 * Money captured against a booking that is not confirmed or completed.
 *
 * This should always be empty. It is not empty when a payment succeeded after
 * the hold expired and the slot had already been resold (see the T24 drill in
 * tests/db/failure-drill.test.ts) — she has been charged for a booking she does
 * not have, and a full refund is owed. Nothing else in the product finds this,
 * so the dashboard asks for it every load.
 */
export type OrphanedPayment = {
  bookingId: string
  reference: string
  amountPaise: number
  bookingStatus: BookingStatus
  capturedAt: string | null
  refunded: boolean
}

export async function listOrphanedPayments(): Promise<OrphanedPayment[]> {
  const service = createServiceClient()
  const { data } = await service
    .from('payments')
    .select(
      `id, amount_paise, captured_at,
       bookings ( id, reference, status, refunds ( id, status ) )`,
    )
    .eq('status', 'captured')
    .order('captured_at', { ascending: true })

  return ((data as any[]) ?? [])
    .filter(
      (p) =>
        p.bookings &&
        !['confirmed', 'completed'].includes(p.bookings.status),
    )
    .map((p) => ({
      bookingId: p.bookings.id,
      reference: p.bookings.reference,
      amountPaise: p.amount_paise,
      bookingStatus: p.bookings.status as BookingStatus,
      capturedAt: p.captured_at,
      refunded: ((p.bookings.refunds ?? []) as any[]).some(
        (r) => r.status === 'success' || r.status === 'pending',
      ),
    }))
    .filter((p) => !p.refunded)
}
