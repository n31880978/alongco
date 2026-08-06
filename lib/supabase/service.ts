import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types'

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * `server-only` above makes importing this from a client component a build
 * error, not a runtime leak (CLAUDE.md §7).
 *
 * Only these paths may use it:
 *   - the payment webhook and the cron routes
 *   - admin server actions, after the caller has been checked against admin_users
 *   - reads of companion_identities, which has no client policy at all (§3.6)
 *
 * Never pass its result straight to a client component without picking columns.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')

  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { 'X-Client-Info': 'alongco-service' } },
    },
  )
}
