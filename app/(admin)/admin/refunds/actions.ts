'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole, writeAudit } from '@/lib/admin/auth'
import { formatPaise } from '@/lib/booking/pricing'

export type RefundState = { error?: string; ok?: string }

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024
const SCREENSHOT_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const markPaidSchema = z.object({
  refundId: z.string().uuid(),
  bookingId: z.string().uuid(),
  paymentReference: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
})

/**
 * Mark a refund as manually paid.
 *
 * Optionally accepts a screenshot (e.g. Razorpay dashboard export, UPI
 * receipt, or bank transfer confirmation) which is stored in the
 * `refund-proofs` storage bucket so there is always a paper trail.
 *
 * This does NOT call Razorpay or any payment provider. The operator confirms
 * they have issued the refund outside this system and uploads proof.
 */
export async function markRefundPaid(
  _prev: RefundState,
  formData: FormData,
): Promise<RefundState> {
  const admin = await requireRole('ops')

  const parsed = markPaidSchema.safeParse({
    refundId: formData.get('refundId'),
    bookingId: formData.get('bookingId'),
    paymentReference: formData.get('paymentReference') || undefined,
    notes: formData.get('notes') || undefined,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  }

  const { refundId, bookingId, paymentReference, notes } = parsed.data
  const service = createServiceClient()

  // Verify the refund exists and is still in a refundable state.
  const { data: refund } = await service
    .from('refunds')
    .select('id, amount_paise, status, tier_applied')
    .eq('id', refundId)
    .maybeSingle()

  if (!refund) return { error: 'That refund record was not found.' }
  if ((refund as any).status === 'success') {
    return { ok: 'Already marked as paid. Nothing changed.' }
  }

  // --- Optional screenshot upload -------------------------------------------
  let proofStorageKey: string | null = null
  const screenshotFile = formData.get('screenshot')

  if (screenshotFile instanceof File && screenshotFile.size > 0) {
    if (screenshotFile.size > MAX_SCREENSHOT_BYTES) {
      return { error: 'Screenshot is over 5 MB. Use a smaller file.' }
    }
    if (!SCREENSHOT_TYPES.includes(screenshotFile.type)) {
      return { error: 'Use a JPEG, PNG or WebP screenshot.' }
    }

    const ext =
      screenshotFile.type === 'image/png'
        ? 'png'
        : screenshotFile.type === 'image/webp'
          ? 'webp'
          : 'jpg'
    proofStorageKey = `${refundId}/${crypto.randomUUID()}.${ext}`

    const { error: uploadError } = await service.storage
      .from('refund-proofs')
      .upload(proofStorageKey, screenshotFile, {
        contentType: screenshotFile.type,
        upsert: false,
      })

    if (uploadError) {
      // Don't fail the whole operation — the mark-paid is more important than
      // the screenshot. Log the failure via the audit entry.
      proofStorageKey = null
    }
  }

  // Build proof URL if upload succeeded.
  const proofUrl = proofStorageKey
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/refund-proofs/${proofStorageKey}`
    : null

  // Update the refund row to success.
  const notesValue = [
    notes,
    paymentReference ? `ref: ${paymentReference}` : null,
    proofStorageKey ? null : screenshotFile instanceof File && screenshotFile.size > 0 ? '(screenshot upload failed)' : null,
  ]
    .filter(Boolean)
    .join(' · ') || null

  const { error: updateError } = await service
    .from('refunds')
    .update({
      status: 'success',
      settled_at: new Date().toISOString(),
      provider_refund_id: paymentReference ?? null,
      proof_url: proofUrl,
      notes: notesValue,
    } as any)
    .eq('id', refundId)

  if (updateError) {
    return { error: 'Could not update the refund record. Nothing was changed.' }
  }

  // Reflect refund total back onto the payment row for reconciliation.
  await markPaymentRefunded(bookingId)

  await writeAudit(admin, {
    action: 'refund.manual_confirm',
    entityType: 'booking',
    entityId: bookingId,
    metadata: {
      refund_id: refundId,
      amount_paise: (refund as any).amount_paise,
      tier: (refund as any).tier_applied,
      has_proof: Boolean(proofUrl),
      payment_reference: paymentReference ?? null,
    },
  })

  revalidatePath('/admin/refunds')
  revalidatePath(`/admin/bookings/${bookingId}`)
  revalidatePath('/admin/payments')

  return {
    ok: `${formatPaise((refund as any).amount_paise)} refund confirmed paid.${proofUrl ? ' Screenshot saved.' : ''}`,
  }
}

/** Reflects refund totals back onto the payment row. */
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

  const full = booking
    ? refunded >= (booking as { amount_paise: number }).amount_paise
    : false

  await service
    .from('payments')
    .update({ status: full ? 'refunded' : 'partially_refunded' })
    .eq('booking_id', bookingId)
    .in('status', ['captured', 'partially_refunded'])
}
