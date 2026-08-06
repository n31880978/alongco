'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole, writeAudit } from '@/lib/admin/auth'

/**
 * Incidents. PRD §6.11 and §9 — "a stated policy with no enforcement record is
 * worse than no policy". This is that record.
 *
 * An incident that ends a booking is created by ac_admin_cancel_booking in the
 * same transaction as the cancellation (see bookings/actions.ts). What is here
 * is for everything else: a report that did not end a booking, or one raised
 * after the fact.
 */

export type IncidentState = { error?: string; ok?: string }

const createSchema = z.object({
  bookingId: z.string().uuid().optional(),
  type: z.enum([
    'conduct_violation',
    'safety_concern',
    'no_show',
    'payment_dispute',
    'other',
  ]),
  reportedBy: z.enum(['customer', 'companion', 'admin']),
  description: z
    .string()
    .trim()
    .min(10, 'Write what actually happened — at least a sentence.')
    .max(4000),
  endedBooking: z.string().optional(),
  refundIssued: z.string().optional(),
})

export async function createIncident(
  _prev: IncidentState,
  formData: FormData,
): Promise<IncidentState> {
  const admin = await requireRole('support')

  const parsed = createSchema.safeParse({
    bookingId: formData.get('bookingId') || undefined,
    type: formData.get('type'),
    reportedBy: formData.get('reportedBy'),
    description: formData.get('description'),
    endedBooking: formData.get('endedBooking') ?? undefined,
    refundIssued: formData.get('refundIssued') ?? undefined,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  }

  const { bookingId, type, reportedBy, description, endedBooking, refundIssued } =
    parsed.data
  const service = createServiceClient()

  // Attach the companion and customer from the booking rather than trusting the
  // form, so an incident can never be filed against the wrong person.
  let companionId: string | null = null
  let customerId: string | null = null
  if (bookingId) {
    const { data } = await service
      .from('bookings')
      .select('companion_id, customer_id')
      .eq('id', bookingId)
      .maybeSingle()
    if (!data) return { error: 'That booking no longer exists.' }
    companionId = (data as { companion_id: string }).companion_id
    customerId = (data as { customer_id: string }).customer_id
  }

  const { data: created, error } = await service
    .from('incidents')
    .insert({
      booking_id: bookingId ?? null,
      companion_id: companionId,
      customer_id: customerId,
      type,
      status: 'open',
      reported_by: reportedBy,
      description,
      ended_booking: endedBooking === 'on',
      refund_issued: refundIssued === 'on',
      created_by: admin.id,
    })
    .select('id')
    .single()

  if (error) return { error: 'The incident could not be saved. Nothing was recorded.' }

  await writeAudit(admin, {
    action: 'incident.create',
    entityType: 'incident',
    entityId: (created as { id: string }).id,
    // The description can carry sensitive detail; the audit records that an
    // incident was opened and against what, not its contents (§9).
    metadata: { type, booking_id: bookingId ?? null, ended_booking: endedBooking === 'on' },
  })

  revalidatePath('/admin/incidents')
  revalidatePath('/admin')
  if (bookingId) revalidatePath(`/admin/bookings/${bookingId}`)
  redirect('/admin/incidents')
}

const resolveSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['open', 'investigating', 'resolved', 'escalated']),
  actionTaken: z.string().trim().max(4000).optional(),
})

export async function updateIncident(
  _prev: IncidentState,
  formData: FormData,
): Promise<IncidentState> {
  const admin = await requireRole('ops')

  const parsed = resolveSchema.safeParse({
    id: formData.get('id'),
    status: formData.get('status'),
    actionTaken: formData.get('actionTaken') || undefined,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  }

  const { id, status, actionTaken } = parsed.data
  const resolved = status === 'resolved'

  if (resolved && !actionTaken?.trim()) {
    return { error: 'Say what was done before marking it resolved.' }
  }

  const service = createServiceClient()
  const { error } = await service
    .from('incidents')
    .update({
      status,
      action_taken: actionTaken || null,
      resolved_at: resolved ? new Date().toISOString() : null,
      resolved_by: resolved ? admin.id : null,
    })
    .eq('id', id)

  if (error) return { error: 'Could not update the incident.' }

  await writeAudit(admin, {
    action: `incident.${status}`,
    entityType: 'incident',
    entityId: id,
    metadata: { status },
  })

  revalidatePath('/admin/incidents')
  revalidatePath('/admin')
  return { ok: resolved ? 'Incident resolved.' : `Incident marked ${status}.` }
}
