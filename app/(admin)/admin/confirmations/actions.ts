'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole, writeAudit } from '@/lib/admin/auth'

/**
 * Confirmation dispatch. PRD §6.8.
 *
 * The message itself is sent by hand from the WhatsApp Business app — nothing
 * here talks to WhatsApp (CLAUDE.md §1). This only records that a human did it,
 * and who, which is what the 15-minute SLA in G5 is measured against.
 */

const markSchema = z.object({ bookingId: z.string().uuid() })

export async function markConfirmationSent(formData: FormData): Promise<void> {
  const admin = await requireRole('support')

  const parsed = markSchema.safeParse({ bookingId: formData.get('bookingId') })
  if (!parsed.success) return

  const service = createServiceClient()

  // Only ever moves null -> now. Re-marking an already-sent booking must not
  // rewrite the original timestamp, or the SLA number becomes a fiction.
  const { data } = await service
    .from('bookings')
    .update({
      confirmation_sent_at: new Date().toISOString(),
      confirmation_sent_by: admin.id,
    })
    .eq('id', parsed.data.bookingId)
    .eq('status', 'confirmed')
    .is('confirmation_sent_at', null)
    .select('id, reference')
    .maybeSingle()

  if (!data) return

  await writeAudit(admin, {
    action: 'confirmation.mark_sent',
    entityType: 'booking',
    entityId: parsed.data.bookingId,
    metadata: { reference: (data as { reference: string }).reference },
  })

  revalidatePath('/admin/confirmations')
  revalidatePath('/admin')
}

const undoSchema = z.object({ bookingId: z.string().uuid() })

/** Marked sent by mistake. Ops-level, and audited as its own action. */
export async function undoConfirmationSent(formData: FormData): Promise<void> {
  const admin = await requireRole('ops')

  const parsed = undoSchema.safeParse({ bookingId: formData.get('bookingId') })
  if (!parsed.success) return

  const service = createServiceClient()
  await service
    .from('bookings')
    .update({ confirmation_sent_at: null, confirmation_sent_by: null })
    .eq('id', parsed.data.bookingId)

  await writeAudit(admin, {
    action: 'confirmation.undo_sent',
    entityType: 'booking',
    entityId: parsed.data.bookingId,
  })

  revalidatePath('/admin/confirmations')
  revalidatePath('/admin')
}
