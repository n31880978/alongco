'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAdmin, requireRole, writeAudit } from '@/lib/admin/auth'

/**
 * Companion management. PRD §6.11.
 *
 * Every mutation here: checks the admin, does the work on the service client,
 * then writes admin_audit_log. The audit write is awaited, not fired and
 * forgotten — an unaudited mutation is a compliance hole.
 */

export type CompanionState = { error?: string; ok?: boolean }

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const baseSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, 'A display name is required.')
    .max(60, 'That display name is too long.'),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(slugPattern, 'Use lowercase letters, numbers and hyphens only.'),
  bio: z.string().trim().max(600, 'Keep the bio under 600 characters.').optional(),
  hourlyRateRupees: z.coerce
    .number()
    .int('Enter whole rupees.')
    .positive('The rate must be above zero.')
    .max(100000, 'That rate looks wrong.'),
  areaIds: z.array(z.string().uuid()).min(1, 'Pick at least one area.'),
})

function parseAreas(formData: FormData): string[] {
  return formData.getAll('areaIds').map(String).filter(Boolean)
}

export async function createCompanion(
  _prev: CompanionState,
  formData: FormData,
): Promise<CompanionState> {
  const admin = await requireRole('ops')

  const parsed = baseSchema.safeParse({
    displayName: formData.get('displayName'),
    slug: formData.get('slug'),
    bio: formData.get('bio') ?? undefined,
    hourlyRateRupees: formData.get('hourlyRateRupees'),
    areaIds: parseAreas(formData),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  }

  const { displayName, slug, bio, hourlyRateRupees, areaIds } = parsed.data
  const service = createServiceClient()

  // Rupees in the form, paise in the database. The only conversion, at the edge.
  const { data, error } = await service
    .from('companions')
    .insert({
      slug,
      display_name: displayName,
      bio: bio || null,
      hourly_rate_paise: hourlyRateRupees * 100,
      // New companions start unlisted. Listing is a deliberate second act,
      // after vetting and a photograph.
      is_active: false,
      is_accepting: true,
    })
    .select('id')
    .single()

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return { error: 'That URL slug is already taken. Pick another.' }
    }
    return { error: 'Could not create the companion. Nothing was saved.' }
  }

  const companionId = (data as { id: string }).id

  await service
    .from('companion_areas')
    .insert(areaIds.map((areaId) => ({ companion_id: companionId, area_id: areaId })))

  await writeAudit(admin, {
    action: 'companion.create',
    entityType: 'companion',
    entityId: companionId,
    metadata: { slug, hourly_rate_paise: hourlyRateRupees * 100 },
  })

  revalidatePath('/admin/companions')
  redirect(`/admin/companions/${companionId}`)
}

export async function updateCompanion(
  _prev: CompanionState,
  formData: FormData,
): Promise<CompanionState> {
  const admin = await requireRole('ops')

  const id = z.string().uuid().safeParse(formData.get('id'))
  if (!id.success) return { error: 'Unknown companion.' }

  const parsed = baseSchema.safeParse({
    displayName: formData.get('displayName'),
    slug: formData.get('slug'),
    bio: formData.get('bio') ?? undefined,
    hourlyRateRupees: formData.get('hourlyRateRupees'),
    areaIds: parseAreas(formData),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  }

  const { displayName, slug, bio, hourlyRateRupees, areaIds } = parsed.data
  const service = createServiceClient()

  const { error } = await service
    .from('companions')
    .update({
      slug,
      display_name: displayName,
      bio: bio || null,
      // Existing bookings keep their snapshotted price — changing the rate here
      // never re-prices a booking that has already been made (§3.1).
      hourly_rate_paise: hourlyRateRupees * 100,
    })
    .eq('id', id.data)

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return { error: 'That URL slug is already taken.' }
    }
    return { error: 'Could not save the changes.' }
  }

  await service.from('companion_areas').delete().eq('companion_id', id.data)
  await service
    .from('companion_areas')
    .insert(areaIds.map((areaId) => ({ companion_id: id.data, area_id: areaId })))

  await writeAudit(admin, {
    action: 'companion.update',
    entityType: 'companion',
    entityId: id.data,
    metadata: { slug, hourly_rate_paise: hourlyRateRupees * 100 },
  })

  revalidatePath('/admin/companions')
  revalidatePath(`/admin/companions/${id.data}`)
  return { ok: true }
}

const toggleSchema = z.object({
  id: z.string().uuid(),
  field: z.enum(['is_active', 'is_accepting']),
  value: z.enum(['true', 'false']),
})

export async function toggleCompanion(formData: FormData): Promise<void> {
  const admin = await requireRole('ops')

  const parsed = toggleSchema.safeParse({
    id: formData.get('id'),
    field: formData.get('field'),
    value: formData.get('value'),
  })
  if (!parsed.success) return

  const { id, field, value } = parsed.data
  const next = value === 'true'

  const service = createServiceClient()
  // Explicit branches rather than a computed key: the generated Supabase types
  // reject an index signature here, and there are only ever two fields.
  const patch = field === 'is_active' ? { is_active: next } : { is_accepting: next }
  await service.from('companions').update(patch).eq('id', id)

  await writeAudit(admin, {
    action: next ? `companion.${field}.on` : `companion.${field}.off`,
    entityType: 'companion',
    entityId: id,
    metadata: { field, value: next },
  })

  revalidatePath('/admin/companions')
  revalidatePath(`/admin/companions/${id}`)
}

// --- weekly availability and blackouts ---------------------------------------

const ruleSchema = z.object({
  companionId: z.string().uuid(),
  weekday: z.coerce.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM.'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM.'),
})

export async function addAvailabilityRule(
  _prev: CompanionState,
  formData: FormData,
): Promise<CompanionState> {
  const admin = await requireRole('ops')

  const parsed = ruleSchema.safeParse({
    companionId: formData.get('companionId'),
    weekday: formData.get('weekday'),
    startTime: formData.get('startTime'),
    endTime: formData.get('endTime'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the times.' }
  }

  const { companionId, weekday, startTime, endTime } = parsed.data
  if (endTime <= startTime) return { error: 'The end time must be after the start.' }

  const service = createServiceClient()
  const { error } = await service.from('companion_availability').insert({
    companion_id: companionId,
    weekday,
    start_time: startTime,
    end_time: endTime,
  })
  if (error) return { error: 'Could not add those hours.' }

  await writeAudit(admin, {
    action: 'companion.availability.add',
    entityType: 'companion',
    entityId: companionId,
    metadata: { weekday, start_time: startTime, end_time: endTime },
  })

  revalidatePath(`/admin/companions/${companionId}`)
  return { ok: true }
}

export async function removeAvailabilityRule(formData: FormData): Promise<void> {
  const admin = await requireRole('ops')
  const id = z.string().uuid().safeParse(formData.get('id'))
  const companionId = z.string().uuid().safeParse(formData.get('companionId'))
  if (!id.success || !companionId.success) return

  const service = createServiceClient()
  await service.from('companion_availability').delete().eq('id', id.data)

  await writeAudit(admin, {
    action: 'companion.availability.remove',
    entityType: 'companion',
    entityId: companionId.data,
    metadata: { rule_id: id.data },
  })
  revalidatePath(`/admin/companions/${companionId.data}`)
}

const blackoutSchema = z.object({
  companionId: z.string().uuid(),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  reason: z.string().trim().max(200).optional(),
})

export async function addBlackout(
  _prev: CompanionState,
  formData: FormData,
): Promise<CompanionState> {
  const admin = await requireRole('ops')

  const parsed = blackoutSchema.safeParse({
    companionId: formData.get('companionId'),
    startsAt: formData.get('startsAt'),
    endsAt: formData.get('endsAt'),
    reason: formData.get('reason') ?? undefined,
  })
  if (!parsed.success) return { error: 'Check the dates.' }

  const { companionId, startsAt, endsAt, reason } = parsed.data
  // datetime-local has no zone; these are always IST wall-clock.
  const start = new Date(`${startsAt}:00+05:30`)
  const end = new Date(`${endsAt}:00+05:30`)
  if (!(end > start)) return { error: 'The end must be after the start.' }

  const service = createServiceClient()
  const { error } = await service.from('companion_blackouts').insert({
    companion_id: companionId,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    reason: reason || null,
  })
  if (error) return { error: 'Could not add that blackout.' }

  await writeAudit(admin, {
    action: 'companion.blackout.add',
    entityType: 'companion',
    entityId: companionId,
    // The reason can be personal; it is not repeated into the audit metadata.
    metadata: { starts_at: start.toISOString(), ends_at: end.toISOString() },
  })

  revalidatePath(`/admin/companions/${companionId}`)
  return { ok: true }
}

export async function removeBlackout(formData: FormData): Promise<void> {
  const admin = await requireRole('ops')
  const id = z.string().uuid().safeParse(formData.get('id'))
  const companionId = z.string().uuid().safeParse(formData.get('companionId'))
  if (!id.success || !companionId.success) return

  const service = createServiceClient()
  await service.from('companion_blackouts').delete().eq('id', id.data)

  await writeAudit(admin, {
    action: 'companion.blackout.remove',
    entityType: 'companion',
    entityId: companionId.data,
    metadata: { blackout_id: id.data },
  })
  revalidatePath(`/admin/companions/${companionId.data}`)
}

// --- identity, owner only ----------------------------------------------------

const identitySchema = z.object({
  companionId: z.string().uuid(),
  legalName: z.string().trim().min(2, 'A legal name is required.'),
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[^\d]/g, ''))
    .refine((v) => /^(91)?[6-9]\d{9}$/.test(v), 'Enter a valid Indian mobile number.')
    .transform((v) => (v.length === 10 ? `91${v}` : v)),
  vettingNotes: z.string().trim().max(2000).optional(),
  agreementSigned: z.string().optional(),
})

/**
 * The internal identity panel. Owner role only (CLAUDE.md §3.6).
 *
 * Nothing written here is ever revalidated onto a public path, and the audit
 * entry records that identity was edited without repeating any of it.
 */
export async function saveIdentity(
  _prev: CompanionState,
  formData: FormData,
): Promise<CompanionState> {
  const admin = await requireRole('owner')

  const parsed = identitySchema.safeParse({
    companionId: formData.get('companionId'),
    legalName: formData.get('legalName'),
    phone: formData.get('phone'),
    vettingNotes: formData.get('vettingNotes') ?? undefined,
    agreementSigned: formData.get('agreementSigned') ?? undefined,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the details.' }
  }

  const { companionId, legalName, phone, vettingNotes, agreementSigned } = parsed.data
  const service = createServiceClient()

  const { error } = await service.from('companion_identities').upsert(
    {
      companion_id: companionId,
      legal_name: legalName,
      phone,
      vetting_notes: vettingNotes || null,
      vetted_at: new Date().toISOString(),
      vetted_by: admin.id,
      agreement_signed_at: agreementSigned === 'on' ? new Date().toISOString() : null,
    },
    { onConflict: 'companion_id' },
  )

  if (error) return { error: 'Could not save the identity record.' }

  await writeAudit(admin, {
    action: 'companion.identity.update',
    entityType: 'companion',
    entityId: companionId,
    // Deliberately empty of identity. §9 — no real names, no phone numbers.
    metadata: { agreement_signed: agreementSigned === 'on' },
  })

  revalidatePath(`/admin/companions/${companionId}`)
  return { ok: true }
}

// --- profile photo -----------------------------------------------------------

const MAX_PHOTO_BYTES = 5 * 1024 * 1024
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/**
 * Uploads a profile photograph to the public `companion-photos` bucket.
 *
 * The upload runs on the service client, not from the browser: there is no
 * insert policy on either storage bucket (0004_storage.sql), so an admin
 * session alone cannot write there. The stored key is deliberately not derived
 * from the original filename — a photographer's filename can carry a real name,
 * and this bucket is public (§3.6).
 */
export async function uploadCompanionPhoto(
  _prev: CompanionState,
  formData: FormData,
): Promise<CompanionState> {
  const admin = await requireRole('ops')

  const id = z.string().uuid().safeParse(formData.get('companionId'))
  if (!id.success) return { error: 'Unknown companion.' }

  const file = formData.get('photo')
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose an image to upload.' }
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return { error: 'That image is over 5 MB. Use a smaller one.' }
  }
  if (!PHOTO_TYPES.includes(file.type)) {
    return { error: 'Use a JPEG, PNG or WebP image.' }
  }

  const service = createServiceClient()
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const key = `${id.data}/${crypto.randomUUID()}.${extension}`

  const { error: uploadError } = await service.storage
    .from('companion-photos')
    .upload(key, file, { contentType: file.type, upsert: false })

  if (uploadError) {
    return { error: 'The upload failed. The existing photo is unchanged.' }
  }

  const { data: previous } = await service
    .from('companions')
    .select('photo_path')
    .eq('id', id.data)
    .maybeSingle()

  const { error } = await service
    .from('companions')
    .update({ photo_path: key })
    .eq('id', id.data)

  if (error) {
    // Do not leave an orphan behind if the row could not be pointed at it.
    await service.storage.from('companion-photos').remove([key])
    return { error: 'The photo uploaded but could not be attached. Try again.' }
  }

  const previousPath = (previous as { photo_path: string | null } | null)?.photo_path
  if (previousPath && previousPath !== key) {
    await service.storage.from('companion-photos').remove([previousPath])
  }

  await writeAudit(admin, {
    action: 'companion.photo.update',
    entityType: 'companion',
    entityId: id.data,
  })

  revalidatePath(`/admin/companions/${id.data}`)
  revalidatePath('/companions')
  return { ok: true }
}
