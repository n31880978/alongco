'use client'

import Script from 'next/script'
import * as React from 'react'
import { GA_MEASUREMENT_ID, track, type FunnelEvent } from '@/lib/analytics/events'

/**
 * Google Analytics, loaded only when a measurement id is configured — with no
 * id set (local, preview, or if you decide against it) nothing is injected and
 * no third-party request is made at all.
 *
 * `anonymize_ip` and the disabled ad signals are deliberate: DPDP consent was
 * collected for arranging a booking, not for advertising (PRD §9).
 */
export function Analytics() {
  if (!GA_MEASUREMENT_ID) return null

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('js', new Date());
          gtag('config', '${GA_MEASUREMENT_ID}', {
            anonymize_ip: true,
            allow_google_signals: false,
            allow_ad_personalization_signals: false
          });
        `}
      </Script>
    </>
  )
}

/**
 * Records one funnel event on mount. Dropped into a server component so the
 * page itself stays a server component.
 */
export function TrackView({
  event,
  companionSlug,
}: {
  event: FunnelEvent
  companionSlug?: string
}) {
  React.useEffect(() => {
    track(event, companionSlug ? { companion_slug: companionSlug } : {})
  }, [event, companionSlug])

  return null
}
