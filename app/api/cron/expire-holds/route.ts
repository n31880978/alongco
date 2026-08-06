import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isAuthorisedCron } from '@/lib/cron'
import { reportCronFailure } from '@/lib/observability/report'

/**
 * Every minute: `pending_payment` past `hold_expires_at` -> `expired`,
 * which returns the slot to availability (CLAUDE.md §8, PRD §6.4).
 *
 * The work is one SQL function using FOR UPDATE SKIP LOCKED, so two overlapping
 * runs cannot expire the same booking twice.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!isAuthorisedCron(request)) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc('ac_expire_holds')

  if (error) {
    // Holds not expiring means slots stay off the market and customers see a
    // fully-booked companion who is actually free. Alert on it (T22).
    reportCronFailure('expire-holds', {}, error)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }

  return NextResponse.json({ expired: data ?? 0 })
}
