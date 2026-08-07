/**
 * One source of truth for the canonical origin and the shared structured data.
 *
 * Import-safe from client components: no secrets, no network, no node builtins.
 */

export const SITE_NAME = 'AlongCo'
export const SITE_TAGLINE = 'meaningful company, on your terms'

/** Canonical origin, never with a trailing slash. */
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (!raw) return 'https://alongco.com'
  return raw.replace(/\/+$/, '')
}

export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith('/') ? path : `/${path}`}`
}

/**
 * Organisation and service description for the landing page.
 *
 * Note what this deliberately does NOT claim. There is no `aggregateRating` on
 * the organisation and no trust/verification signal anywhere: CLAUDE.md §3.7
 * forbids describing a companion as verified or background-checked in any UI,
 * and structured data is UI — it renders as a rich result. A star rating in a
 * search listing would also be a rating of the business rather than of a
 * completed booking, which is exactly the claim reviews here are careful not
 * to make.
 */
export function organisationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${siteUrl()}/#organisation`,
    name: SITE_NAME,
    url: siteUrl(),
    description:
      'Book an hour of company in a public place in Bangalore. No romance, a fixed price shown before you enter any details, and a clear way to end it.',
    areaServed: {
      '@type': 'City',
      name: 'Bangalore',
      containedInPlace: { '@type': 'Country', name: 'India' },
    },
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Bangalore',
      addressRegion: 'Karnataka',
      addressCountry: 'IN',
    },
    priceRange: '₹₹',
    openingHoursSpecification: {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: [
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
        'Sunday',
      ],
      opens: '08:00',
      closes: '22:00',
    },
  }
}

/**
 * A companion profile, as an Offer rather than a Person.
 *
 * Person would invite search engines to build a knowledge-panel entity around
 * someone who is listed under a pseudonym precisely so he is not identifiable
 * (CLAUDE.md §3.6). An Offer describes the bookable hour, which is the thing
 * actually for sale.
 */
export function companionOfferJsonLd(input: {
  displayName: string
  slug: string
  bio: string | null
  hourlyRatePaise: number
  areas: string[]
  photoUrl: string | null
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Offer',
    url: absoluteUrl(`/companions/${input.slug}`),
    name: `An hour of company with ${input.displayName}`,
    description: input.bio ?? undefined,
    image: input.photoUrl ?? undefined,
    priceCurrency: 'INR',
    price: (input.hourlyRatePaise / 100).toFixed(2),
    availability: 'https://schema.org/InStock',
    areaServed: input.areas.map((name) => ({ '@type': 'Place', name })),
    seller: { '@id': `${siteUrl()}/#organisation` },
  }
}

/** Renders a JSON-LD block. */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      // Structured data is generated from our own data, never from user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}
