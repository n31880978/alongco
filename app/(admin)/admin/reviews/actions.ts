'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole, writeAudit } from '@/lib/admin/auth'

/**
 * Review moderation. PRD §6.10.
 *
 * Three outcomes, matching the admin canvas: publish, hold, reject.
 *
 *   pending   moderated_at is null
 *   published is_published = true
 *   rejected  moderated_at set, is_published = false
 *   held      still pending, with a note saying why
 *
 * "Verified review" only ever means the review is tied to a completed booking.
 * It is never a claim about the companion (CLAUDE.md §3.7).
 */

export type ReviewState = { error?: string; ok?: string }

const schema = z.object({
  id: z.string().uuid(),
  decision: z.enum(['publish', 'hold', 'reject']),
  note: z.string().trim().max(500).optional(),
})

export async function moderateReview(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const admin = await requireRole('ops')

  const parsed = schema.safeParse({
    id: formData.get('id'),
    decision: formData.get('decision'),
    note: formData.get('note') || undefined,
  })
  if (!parsed.success) return { error: 'Check the form.' }

  const { id, decision, note } = parsed.data
  const service = createServiceClient()

  // A review attached to a booking with an open incident is never published
  // automatically, and cannot be published by hand while that incident is open.
  if (decision === 'publish') {
    const { data: publishable } = await service.rpc('ac_review_publishable', {
      p_review_id: id,
    })
    if (publishable === false) {
      return {
        error:
          'This review is tied to an open incident. Resolve the incident first — publishing it now would put a rating on the site while the facts are still in dispute.',
      }
    }
  }

  const now = new Date().toISOString()
  const patch =
    decision === 'publish'
      ? { is_published: true, moderated_at: now, moderated_by: admin.id, moderation_note: note || null }
      : decision === 'reject'
        ? { is_published: false, moderated_at: now, moderated_by: admin.id, moderation_note: note || null }
        : // Hold: stays in the queue, with the reason recorded.
          { is_published: false, moderated_at: null, moderated_by: null, moderation_note: note || null }

  const { data, error } = await service
    .from('reviews')
    .update(patch)
    .eq('id', id)
    .select('companion_id, companions ( slug )')
    .maybeSingle()

  if (error || !data) return { error: 'Could not save that decision.' }

  await writeAudit(admin, {
    action: `review.${decision}`,
    entityType: 'review',
    entityId: id,
    metadata: { decision },
  })

  revalidatePath('/admin/reviews')
  revalidatePath('/admin')
  revalidatePath('/companions')
  const slug = (data as { companions?: { slug?: string } }).companions?.slug
  if (slug) revalidatePath(`/c/${slug}`)

  return {
    ok:
      decision === 'publish'
        ? 'Published. It is live on his profile.'
        : decision === 'reject'
          ? 'Rejected. It will not appear anywhere.'
          : 'Held. It stays in the queue.',
  }
}
