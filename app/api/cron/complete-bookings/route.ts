import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isAuthorisedCron } from '@/lib/cron'
import { reportCronFailure } from '@/lib/observability/report'

/**
 * Hourly: `confirmed` past `ends_at` -> `completed` (CLAUDE.md §8).
 *
 * Completion is what unlocks the review, so this is also the gate behind
 * PRD §6.10 — a booking that never completes can never be reviewed.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!isAuthorisedCron(request)) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc('ac_complete_bookings')

  if (error) {
    // Bookings that never complete can never be reviewed, and the revenue
    // figures stay wrong. Alert on it (T22).
    reportCronFailure('complete-bookings', {}, error)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }

  return NextResponse.json({ completed: data ?? 0 })
}
