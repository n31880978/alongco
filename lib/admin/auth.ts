import 'server-only'
import { cache } from 'react'
import { notFound, redirect } from 'next/navigation'
import { headers } from 'next/headers'
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

/**
 * Use at the top of every admin page and every admin server action.
 *
 * Two different failures, treated differently on purpose (CLAUDE.md §9):
 *
 *   no session at all  -> the visitor is sent to the admin sign-in page. That
 *                         page takes an email and password and refuses anyone
 *                         without an admin_users row, so it is not "a login
 *                         that would accept her".
 *   session, not admin -> notFound(). An authenticated customer who reaches an
 *                         admin URL is REFUSED, not redirected. Bouncing her to
 *                         a login would both confirm the route exists and
 *                         invite her to try.
 */
export async function requireAdmin(): Promise<Admin> {
  const admin = await getCurrentAdmin()
  if (admin) return admin

  const authUserId = await getAuthUserId()
  if (authUserId) notFound()

  redirect(await adminSignInPath())
}

/**
 * Canonical sign-in URL for the host being served.
 *
 * On ADMIN_HOST the proxy rewrites bare paths into `/admin/*`, so `/sign-in` is
 * the address an operator sees and `/admin` never appears. On localhost there is
 * no second hostname to route on, so the prefix is the switch.
 */
export async function adminSignInPath(): Promise<string> {
  try {
    const h = await headers()
    const host = (h.get('host') ?? '').split(':')[0].toLowerCase()
    const adminHost = (process.env.ADMIN_HOST ?? 'admin.alongco.com')
      .split(':')[0]
      .toLowerCase()
    if (host === adminHost) return '/sign-in'
  } catch {
    // No request scope. Fall through to the prefixed path, which resolves on
    // both hosts even though it is not the pretty one.
  }
  return '/admin/sign-in'
}

async function getAuthUserId(): Promise<string | null> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return user?.id ?? null
  } catch {
    return null
  }
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
