/**
 * Next.js middleware entry point.
 *
 * The actual implementation lives in proxy.ts — it handles both the admin
 * (Supabase session) and customer (Clerk) auth systems with host-based routing.
 * This file exists purely because Next.js requires the export to be named
 * `middleware` and the file to be called `middleware.ts` at the project root.
 *
 * Without this file, Clerk middleware never runs and the Google OAuth callback
 * can't complete — the session is never injected, so every SSO return lands
 * back on the homepage instead of proceeding.
 */
export { proxy as middleware, config } from './proxy'
