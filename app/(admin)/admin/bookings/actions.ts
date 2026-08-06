'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole, writeAudit } from '@/lib/admin/auth'
import { createRefund, mapRefundStatus } from '@/lib/cashfree/refunds'
import { formatPaise } from '@/lib/booking/pricing'

/**
 * Cancellation, refunds and no-shows. PRD §6.9, TASKS T16 and T17.
 *
 * The database does the arithmetic and the state change in one transaction
 * (ac_admin_cancel_booking); this only carries the result to Cashfree and
 * writes back what Cashfree said. If the network call fails, the refund row
 * survives in a non-success state — a refund we owe and have recorded is
 * recoverable, a refund we issued and did not record is not.
 */

export type BookingActionState = { error?: string; ok?: string }

const TRIGGERS = [
  'admin_cancel',
  'companion_cancel',
  'companion_no_show',
  'customer_no_show',
  'conduct_breach',
] as const

const cancelSchema = z.object({
  bookingId: z.string().uuid(),
  trigger: z.enum(TRIGGERS),
  reason: z.string().trim().max(500).optional(),
  incidentType: z
    .enum(['conduct_violation', 'safety_concern', 'no_show', 'payment_dispute', 'other'])
    .optional(),
  incidentDescription: z.string().trim().max(2000).optional(),
})

type CancelResult = {
  to_status: string
  tier_code: string
  percent: number
  refund_amount_paise: number
  refund_id: string | null
  refund_reference: string | null
  incident_id: string | null
  cashfree_order_id: string | null
}

const DB_MESSAGES: Record<string, string> = {
  AC_BOOKING_NOT_FOUND: 'That booking no longer exists.',
  AC_NOT_CANCELLABLE:
    'This booking is already cancelled, expired or ended — nothing was changed.',
  AC_INCIDENT_REQUIRED:
    'Ending a booking early needs an incident record. Describe what happened before confirming.',
  AC_UNKNOWN_TRIGGER: 'Pick a cancellation reason from the list.',
}

export async function cancelBooking(
  _prev: BookingActionState,
  formData: FormData,
): Promise<BookingActionState> {
  const admin = await requireRole('ops')

  const parsed = cancelSchema.safeParse({
    bookingId: formData.get('bookingId'),
    trigger: formData.get('trigger'),
    reason: formData.get('reason') || undefined,
    incidentType: formData.get('incidentType') || undefined,
    incidentDescription: formData.get('incidentDescription') || undefined,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  }

  const { bookingId, trigger, reason, incidentType, incidentDescription } = parsed.data
  const service = createServiceClient()

  const { data, error } = await service.rpc('ac_admin_cancel_booking', {
    p_booking_id: bookingId,
    p_admin_id: admin.id,
    p_trigger: trigger,
    p_reason: reason ?? null,
    p_incident_type: incidentType ?? null,
    p_incident_description: incidentDescription ?? null,
  })

  if (error) {
    const code = Object.keys(DB_MESSAGES).find((k) => error.message.includes(k))
    return {
      error: code
        ? DB_MESSAGES[code]
        : 'The cancellation could not be recorded. Nothing was changed and no refund was sent.',
    }
  }

  const result = data as unknown as CancelResult

  await writeAudit(admin, {
    action: 'booking.cancel',
    entityType: 'booking',
    entityId: bookingId,
    metadata: {
      trigger,
      tier: result.tier_code,
      refund_amount_paise: result.refund_amount_paise,
      to_status: result.to_status,
    },
  })

  revalidatePath('/admin/bookings')
  revalidatePath(`/admin/bookings/${bookingId}`)
  revalidatePath('/admin')

  if (!result.refund_id || !result.refund_reference || !result.cashfree_order_id) {
    return {
      ok: `Booking ${result.to_status.replace(/_/g, ' ')}. No refund is due under ${result.tier_code}.`,
    }
  }

  // The booking is already cancelled and the refund is already recorded as owed.
  // Everything past this point is about the provider, and is reported as such —
  // she needs to know whether her money moved (CLAUDE.md §6).
  try {
    const cf = await createRefund({
      cashfreeOrderId: result.cashfree_order_id,
      refundReference: result.refund_reference,
      amountPaise: result.refund_amount_paise,
      note: result.tier_code,
    })

    const status = mapRefundStatus(cf.refund_status)
    await service
      .from('refunds')
      .update({
        cashfree_refund_id: String(cf.cf_refund_id),
        status,
        settled_at: status === 'success' ? new Date().toISOString() : null,
      })
      .eq('id', result.refund_id)

    await markPaymentRefunded(bookingId)

    await writeAudit(admin, {
      action: 'refund.issue',
      entityType: 'booking',
      entityId: bookingId,
      metadata: {
        tier: result.tier_code,
        amount_paise: result.refund_amount_paise,
        refund_status: status,
      },
    })

    revalidatePath(`/admin/bookings/${bookingId}`)
    revalidatePath('/admin/payments')

    return {
      ok:
        status === 'success'
          ? `Cancelled. ${formatPaise(result.refund_amount_paise)} refunded under ${result.tier_code}.`
          : `Cancelled. ${formatPaise(result.refund_amount_paise)} refund accepted by Cashfree and is ${status} — it will settle to her original method.`,
    }
  } catch (err) {
    await service
      .from('refunds')
      .update({
        status: 'failed',
        notes: `${result.tier_code} · provider call failed`,
      })
      .eq('id', result.refund_id)

    await writeAudit(admin, {
      action: 'refund.failed',
      entityType: 'booking',
      entityId: bookingId,
      metadata: {
        tier: result.tier_code,
        amount_paise: result.refund_amount_paise,
      },
    })

    revalidatePath(`/admin/bookings/${bookingId}`)

    return {
      error: `The booking is cancelled, but Cashfree refused the ${formatPaise(
        result.refund_amount_paise,
      )} refund. It is recorded as owed and can be retried from this page — no money has moved. (${
        err instanceof Error ? err.message : 'provider error'
      })`,
    }
  }
}

/** Reflects the refund total back onto the payment row for reconciliation. */
async function markPaymentRefunded(bookingId: string): Promise<void> {
  const service = createServiceClient()

  const { data: booking } = await service
    .from('bookings')
    .select('amount_paise')
    .eq('id', bookingId)
    .maybeSingle()

  const { data: refunds } = await service
    .from('refunds')
    .select('amount_paise, status')
    .eq('booking_id', bookingId)

  const refunded = ((refunds as { amount_paise: number; status: string }[]) ?? [])
    .filter((r) => r.status === 'success' || r.status === 'pending')
    .reduce((sum, r) => sum + r.amount_paise, 0)

  if (refunded <= 0) return

  const full = booking ? refunded >= (booking as { amount_paise: number }).amount_paise : false

  await service
    .from('payments')
    .update({ status: full ? 'refunded' : 'partially_refunded' })
    .eq('booking_id', bookingId)
    .in('status', ['captured', 'partially_refunded'])
}

/**
 * Retry a refund that Cashfree refused. Safe to press repeatedly: the refund
 * reference is unchanged, and Cashfree treats a repeat of the same refund_id as
 * the same refund rather than a second one.
 */
const retrySchema = z.object({ refundId: z.string().uuid() })

export async function retryRefund(
  _prev: BookingActionState,
  formData: FormData,
): Promise<BookingActionState> {
  const admin = await requireRole('ops')

  const parsed = retrySchema.safeParse({ refundId: formData.get('refundId') })
  if (!parsed.success) return { error: 'Check the form.' }

  const service = createServiceClient()
  const { data } = await service
    .from('refunds')
    .select('id, booking_id, amount_paise, refund_reference, tier_applied, status, payments ( cashfree_order_id )')
    .eq('id', parsed.data.refundId)
    .maybeSingle()

  if (!data) return { error: 'That refund record no longer exists.' }
  const row = data as any

  if (row.status === 'success') {
    return { ok: 'That refund has already settled. Nothing was sent again.' }
  }

  const orderId = row.payments?.cashfree_order_id
  if (!orderId) {
    return { error: 'No captured Cashfree payment is linked to this booking.' }
  }

  try {
    const cf = await createRefund({
      cashfreeOrderId: orderId,
      refundReference: row.refund_reference,
      amountPaise: row.amount_paise,
      note: row.tier_applied ?? 'AlongCo cancellation',
    })

    const status = mapRefundStatus(cf.refund_status)
    await service
      .from('refunds')
      .update({
        cashfree_refund_id: String(cf.cf_refund_id),
        status,
        settled_at: status === 'success' ? new Date().toISOString() : null,
      })
      .eq('id', row.id)

    await markPaymentRefunded(row.booking_id)

    await writeAudit(admin, {
      action: 'refund.retry',
      entityType: 'booking',
      entityId: row.booking_id,
      metadata: { amount_paise: row.amount_paise, refund_status: status },
    })

    revalidatePath(`/admin/bookings/${row.booking_id}`)
    revalidatePath('/admin/payments')

    return {
      ok: `${formatPaise(row.amount_paise)} refund is now ${status} with Cashfree.`,
    }
  } catch (err) {
    await writeAudit(admin, {
      action: 'refund.retry_failed',
      entityType: 'booking',
      entityId: row.booking_id,
      metadata: { amount_paise: row.amount_paise },
    })
    return {
      error: `Cashfree refused it again. The refund is still recorded as owed. (${
        err instanceof Error ? err.message : 'provider error'
      })`,
    }
  }
}
