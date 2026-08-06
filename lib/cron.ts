import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'

/**
 * CRON_SECRET verification. CLAUDE.md §8 — both cron routes verify before doing
 * anything at all.
 *
 * Accepts either `Authorization: Bearer <secret>` (what Vercel Cron sends) or
 * an `x-cron-secret` header for manual invocation.
 */
export function isAuthorisedCron(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  // No secret configured means the route is closed, not open.
  if (!expected) return false

  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const header = request.headers.get('x-cron-secret')
  const provided = bearer || header
  if (!provided) return false

  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
