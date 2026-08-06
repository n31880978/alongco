import 'server-only'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { Customer } from '@/lib/supabase/types'

/**
 * Who is asking. Deduplicated per request.
 *
 * Always reads through the anon-key server client, so what comes back is what
 * RLS permits — a bug here cannot widen access beyond the policy.
 */

export const getCurrentCustomer = cache(async (): Promise<Customer | null> => {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null

    const { data } = await supabase
      .from('customers')
      .select('*')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    return (data as Customer) ?? null
  } catch {
    return null
  }
})

export const getAuthUserId = cache(async (): Promise<string | null> => {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return user?.id ?? null
  } catch {
    return null
  }
})
