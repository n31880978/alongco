import 'server-only'
import { cache } from 'react'
import { auth, currentUser } from '@clerk/nextjs/server'
import { createCustomerClient } from '@/lib/supabase/customer'
import { createServiceClient } from '@/lib/supabase/service'
import { CONSENT_VERSION } from '@/lib/booking/terms'
import { report } from '@/lib/observability/report'
import type { Customer } from '@/lib/supabase/types'

/**
 * Who is asking. Deduplicated per request.
 *
 * Identity comes from Clerk; the customer record comes from Supabase, read
 * through the customer client so what comes back is exactly what RLS permits.
 * A bug here cannot widen access beyond the policy.
 */

export const getAuthSubject = cache(async (): Promise<string | null> => {
  try {
    const { userId } = await auth()
    return userId ?? null
  } catch {
    return null
  }
})

export const getCurrentCustomer = cache(async (): Promise<Customer | null> => {
  try {
    const subject = await getAuthSubject()
    if (!subject) return null

    const supabase = createCustomerClient()
    const { data } = await supabase
      .from('customers')
      .select('*')
      .eq('auth_user_id', subject)
      .maybeSingle()

    return (data as Customer) ?? null
  } catch {
    return null
  }
})

/**
 * Creates the customer record on first sign-in, or adopts one already holding
 * this email (PRD §6.3).
 *
 * Runs on the service client because ac_ensure_customer is service_role only:
 * it adopts by email, so a caller able to pass an arbitrary address could
 * attach their Clerk id to someone else's bookings. The email is taken from
 * Clerk's verified record here, never from anything the browser sent.
 *
 * Called lazily rather than from a webhook, so a customer who signs up while
 * the webhook is down still gets a record the moment she does anything.
 */
export async function ensureCustomer(): Promise<Customer | null> {
  const subject = await getAuthSubject()
  if (!subject) return null

  const user = await currentUser()
  const email = user?.primaryEmailAddress?.emailAddress
  if (!email) return null

  const service = createServiceClient()
  const { error } = await service.rpc('ac_ensure_customer', {
    p_subject: subject,
    p_email: email,
    p_full_name: user.firstName ? `${user.firstName} ${user.lastName ?? ''}`.trim() : null,
    p_consent_version: CONSENT_VERSION,
  })
  if (error) {
    report('auth', 'ac_ensure_customer failed', {
      severity: 'error',
      context: { code: (error as { code?: string }).code },
    })
    return null
  }

  const { data } = await service
    .from('customers')
    .select('*')
    .eq('auth_user_id', subject)
    .maybeSingle()

  return (data as Customer) ?? null
}

/**
 * The customer record, creating it if this is her first action.
 *
 * Use this anywhere a customer record must exist — holding a slot, saving
 * details, paying. getCurrentCustomer alone returns null for a brand-new Clerk
 * user who has signed in but never had a row written.
 */
export async function requireCustomer(): Promise<Customer | null> {
  return (await getCurrentCustomer()) ?? (await ensureCustomer())
}
