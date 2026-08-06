import 'server-only'
import { cache } from 'react'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { AdminRole, AdminUser } from '@/lib/supabase/types'

/**
 * Admin identity. PRD §6.11 and CLAUDE.md §9.
 *
 * A non-admin — including a perfectly valid, signed-in customer — must be
 * REFUSED, not redirected to a login that would accept her. So every failure
 * here is notFound(): the admin surface does not acknowledge that it exists.
 */

export type Admin = AdminUser

export const getCurrentAdmin = cache(async (): Promise<Admin | null> => {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null

    // admin_users has RLS on with no policy, so this must be the service client.
    // The lookup is keyed on the verified auth user id, never on anything the
    // request supplied.
    const service = createServiceClient()
    const { data } = await service
      .from('admin_users')
      .select('*')
      .eq('id', user.id)
      .eq('is_active', true)
      .maybeSingle()

    return (data as Admin) ?? null
  } catch {
    return null
  }
})

/** Use at the top of every admin page and every admin server action. */
export async function requireAdmin(): Promise<Admin> {
  const admin = await getCurrentAdmin()
  if (!admin) notFound()
  return admin
}

/**
 * Roles, narrowest first. `owner` is the only role that may see real names, ID
 * documents or vetting notes (CLAUDE.md §3.6).
 */
const RANK: Record<AdminRole, number> = { support: 1, ops: 2, owner: 3 }

export function hasRole(admin: Admin, minimum: AdminRole): boolean {
  return RANK[admin.role] >= RANK[minimum]
}

export async function requireRole(minimum: AdminRole): Promise<Admin> {
  const admin = await requireAdmin()
  if (!hasRole(admin, minimum)) notFound()
  return admin
}

/**
 * Every state-changing admin action writes here. CLAUDE.md §6, PRD §6.11.
 *
 * Metadata must never carry a phone number, a real name or a payment payload
 * (§9) — record ids and amounts, which is what a dispute actually needs.
 */
export async function writeAudit(
  admin: Admin,
  entry: {
    action: string
    entityType: string
    entityId?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  const service = createServiceClient()
  const { error } = await service.from('admin_audit_log').insert({
    admin_id: admin.id,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    metadata: (entry.metadata ?? {}) as Record<string, unknown>,
  })

  // An unaudited mutation is worse than a failed one — surface it.
  if (error) throw new Error(`audit log write failed for ${entry.action}`)
}
