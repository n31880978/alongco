import type { MetadataRoute } from 'next'
import { listCompanions } from '@/lib/companions'
import { POLICY_ORDER } from '@/lib/policies'
import { siteUrl } from '@/lib/seo'

/**
 * Only pages a stranger should be able to find.
 *
 * Deliberately absent: /book/*, /bookings, /ticket/*, /t/*, /review/* and the
 * whole admin surface. A ticket URL contains a booking reference and a review
 * URL identifies a completed meeting — indexing either would put a customer's
 * booking into a search result (CLAUDE.md §3.6, §9). robots.ts blocks them too;
 * this is the second of the two locks.
 */
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl()
  const now = new Date()

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    {
      url: `${base}/companions`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${base}/policies`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ]

  const policyRoutes: MetadataRoute.Sitemap = POLICY_ORDER.map((slug) => ({
    url: `${base}/policies/${slug}`,
    lastModified: now,
    changeFrequency: 'monthly' as const,
    // Higher than a policy page would normally warrant: a payment gateway's
    // underwriting checks these are live and reachable (PRD §6.12).
    priority: 0.4,
  }))

  let companionRoutes: MetadataRoute.Sitemap = []
  try {
    const companions = await listCompanions()
    // listCompanions is already RLS-scoped to listed companions, so a paused or
    // unlisted profile can never reach the sitemap.
    companionRoutes = companions.map((c) => ({
      url: `${base}/companions/${c.slug}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }))
  } catch {
    // A database blip should degrade the sitemap, not fail the whole route and
    // hand search engines a 500.
  }

  return [...staticRoutes, ...policyRoutes, ...companionRoutes]
}
