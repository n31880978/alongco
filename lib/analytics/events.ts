/**
 * Analytics. TASKS T23 — "the funnel events in PRD §10, nothing more".
 *
 * PRD §10 measures exactly five transitions:
 *
 *   landing            → browse
 *   profile            → slot selection
 *   slot               → payment initiated
 *   payment initiated  → confirmed
 *   profile            → ticket   (median duration)
 *
 * So there are six events here and no others. No scroll depth, no rage clicks,
 * no session recording. The audience is deciding on safety while browsing at
 * night, and a woman who feels watched does not book.
 *
 * Nothing identifying is ever sent: no phone, no name, no booking reference, no
 * amount (CLAUDE.md §9). A companion slug is public information and is the only
 * dimension carried.
 */

export type FunnelEvent =
  | 'view_landing'
  | 'view_browse'
  | 'view_profile'
  | 'select_slot'
  | 'begin_checkout'
  | 'booking_confirmed'

type EventParams = {
  /** Public URL slug. Never an id, never a name. */
  companion_slug?: string
  /** 60, 120, 180 — the duration chosen, not the price. */
  duration_minutes?: number
}

declare global {
  interface Window {
    gtag?: (
      command: 'event' | 'config' | 'js',
      target: string,
      params?: Record<string, unknown>,
    ) => void
    dataLayer?: unknown[]
  }
}

export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? ''

/** Fire and forget. Analytics must never break a booking. */
export function track(event: FunnelEvent, params: EventParams = {}): void {
  if (typeof window === 'undefined') return
  if (!GA_MEASUREMENT_ID) return
  try {
    window.gtag?.('event', event, params)
  } catch {
    // Blocked by an extension, or offline. Nothing to do and nothing to say.
  }
}
