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
 *
 * CONNECTION POOLING: this client connects via the Supabase JS SDK which uses
 * the REST/PostgREST API, not raw Postgres — so it is not affected by direct
 * connection limits. Each serverless invocation creates a fresh HTTP client;
 * there is no persistent connection pool to exhaust. If you add raw `pg`
 * queries anywhere, always use the transaction pooler URL (port 6543 on
 * Supabase), never the direct connection (port 5432).
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')

  return createSupabaseClient<Database>(
    url,
    key,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { 'X-Client-Info': 'alongco-service' } },
    },
  )
}
