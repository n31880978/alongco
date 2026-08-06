/**
 * Supabase renamed the browser-safe `anon` key to `publishable` key. Support
 * both names while deployments migrate; neither is privileged and RLS remains
 * the data boundary.
 */
export function supabasePublicKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}
