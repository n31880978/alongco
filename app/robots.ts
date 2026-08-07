import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/seo'

/**
 * What a crawler may look at.
 *
 * The disallow list is the point. A ticket URL carries a booking reference, a
 * review URL identifies a completed meeting, and /book/* carries a live hold —
 * none of it should ever surface in a search result (CLAUDE.md §9). The admin
 * host is refused at the proxy already; this says so out loud as well, since a
 * crawler that never requests the page cannot leak its existence through a
 * 404-vs-200 difference.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin',
          '/admin/',
          '/api/',
          '/auth/',
          '/book/',
          '/bookings',
          '/review/',
          '/sign-in',
          '/t/',
          '/ticket/',
        ],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  }
}
