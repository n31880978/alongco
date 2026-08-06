'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole, writeAudit } from '@/lib/admin/auth'

/**
 * Customer administration. PRD §6.11 and §9 (DPDP).
 *
 * Blocking is deliberately reversible and reasoned: a blocked customer is
 * refused at booking with a neutral message and no slot is held (PRD §6.3).
 */

export type CustomerState = { error?: string; ok?: string }

const blockSchema = z.object({
  id: z.string().uuid(),
  blocked: z.enum(['true', 'false']),
  reason: z.string().trim().max(500).optional(),
})

export async function setCustomerBlocked(
  _prev: CustomerState,
  formData: FormData,
): Promise<CustomerState> {
  const admin = await requireRole('ops')

  const parsed = blockSchema.safeParse({
    id: formData.get('id'),
    blocked: formData.get('blocked'),
    reason: formData.get('reason') || undefined,
  })
  if (!parsed.success) return { error: 'Check the form.' }

  const { id, blocked, reason } = parsed.data
  const isBlocking = blocked === 'true'

  if (isBlocking && !reason?.trim()) {
    return { error: 'Give a reason before blocking someone.' }
  }

  const service = createServiceClient()
  const { error } = await service
    .from('customers')
    .update({
      is_blocked: isBlocking,
      block_reason: isBlocking ? (reason ?? null) : null,
    })
    .eq('id', id)

  if (error) return { error: 'Could not update this customer.' }

  await writeAudit(admin, {
    action: isBlocking ? 'customer.block' : 'customer.unblock',
    entityType: 'customer',
    entityId: id,
    // The reason can name people; the audit records that it happened, not who
    // was named in it (§9).
    metadata: { blocked: isBlocking },
  })

  revalidatePath('/admin/customers')
  return { ok: isBlocking ? 'Blocked.' : 'Unblocked.' }
}

const erasureSchema = z.object({ id: z.string().uuid() })

/**
 * Marks a DPDP erasure request as handled.
 *
 * The actual purge is not a button: bookings are anonymised and payment records
 * are retained for as long as the law requires, which is a considered operation
 * run outside this screen. This records that the request was answered.
 */
export async function clearErasureRequest(
  _prev: CustomerState,
  formData: FormData,
): Promise<CustomerState> {
  const admin = await requireRole('owner')

  const parsed = erasureSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) return { error: 'Check the form.' }

  const service = createServiceClient()
  const { error } = await service
    .from('customers')
    .update({ deletion_requested_at: null })
    .eq('id', parsed.data.id)

  if (error) return { error: 'Could not update this record.' }

  await writeAudit(admin, {
    action: 'customer.erasure.answered',
    entityType: 'customer',
    entityId: parsed.data.id,
  })

  revalidatePath('/admin/customers')
  return { ok: 'Marked as answered.' }
}
