'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { hashIdentifier, clientIp } from '@/lib/auth/rate-limit'
import { adminSignInPath, writeAudit, type Admin } from '@/lib/admin/auth'

/**
 * Admin sign-in. PRD §6.11.
 *
 * Email and password, deliberately a different credential class from the
 * customer's phone OTP. Two consequences that matter:
 *
 *  - A customer cannot reach the admin surface by any route, because her
 *    credential type does not exist here. She has no password.
 *  - Holding a valid Supabase session is not enough. The session is checked
 *    against `admin_users`, and a signed-in non-admin is signed straight back
 *    out — otherwise anyone with an account on the project could obtain a
 *    session on the admin host and rely on page-level checks alone.
 *
 * Every outcome is reported with the same wording. Whether an email belongs to
 * an admin, whether the password was wrong, and whether the account is
 * deactivated are indistinguishable from outside.
 */

export type SignInState = { error?: string }

const schema = z.object({
  email: z.string().trim().toLowerCase().email('Enter the email on your admin account.'),
  password: z.string().min(1, 'Enter your password.'),
})

const REFUSED = 'Those details were not accepted.'

export async function signInAdmin(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = schema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? REFUSED }
  }

  const { email, password } = parsed.data

  let emailHash: string
  let ipHash: string
  try {
    emailHash = hashIdentifier(email)
    ipHash = hashIdentifier(await clientIp())
  } catch {
    // OTP_HASH_SALT missing. Refuse rather than sign in unthrottled.
    return { error: 'Sign-in is unavailable right now.' }
  }

  const service = createServiceClient()

  const { data: limit } = await service.rpc('ac_consume_admin_login_attempt', {
    p_email_hash: emailHash,
    p_ip_hash: ipHash,
  })
  const gate = limit?.[0]
  if (gate && !gate.allowed) {
    return {
      error: 'Too many failed attempts. Try again in fifteen minutes.',
    }
  }

  const record = async (succeeded: boolean) => {
    await service
      .rpc('ac_record_admin_login_attempt', {
        p_email_hash: emailHash,
        p_ip_hash: ipHash,
        p_succeeded: succeeded,
      })
      .then(
        () => undefined,
        () => undefined,
      )
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    await record(false)
    return { error: REFUSED }
  }

  // A valid Supabase user is not an admin. Check, and if not, end the session
  // immediately — do not leave a usable cookie on the admin host.
  const { data: adminRow } = await service
    .from('admin_users')
    .select('*')
    .eq('id', data.user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (!adminRow) {
    await supabase.auth.signOut()
    await record(false)
    return { error: REFUSED }
  }

  await record(true)

  await writeAudit(adminRow as Admin, {
    action: 'admin.sign_in',
    entityType: 'admin_user',
    entityId: (adminRow as Admin).id,
    // No email, no IP — that it happened and who, nothing more (§9).
    metadata: { role: (adminRow as Admin).role },
  })

  redirect('/admin')
}

export async function signOutAdmin(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect(await adminSignInPath())
}
