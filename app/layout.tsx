import type { Metadata, Viewport } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'
import { SITE_NAME, siteUrl } from '@/lib/seo'

const DESCRIPTION =
  'Book an hour of company in a public place in Bangalore. No romance, no obligation, a fixed price shown before you enter any details, and a clear way to end it.'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${SITE_NAME} — meaningful company, on your terms`,
    template: `%s · ${SITE_NAME}`,
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  // Every page resolves its own canonical against metadataBase. Without this a
  // profile reachable with tracking parameters would be indexed several times
  // over as separate pages.
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    locale: 'en_IN',
    url: siteUrl(),
    title: `${SITE_NAME} — meaningful company, on your terms`,
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — meaningful company, on your terms`,
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  formatDetection: {
    // Stops iOS turning booking references and times into tap-to-call links,
    // which mangles the ticket.
    telephone: false,
    date: false,
    address: false,
  },
  category: 'lifestyle',
}

export const viewport: Viewport = {
  themeColor: '#FBFAF7',
  width: 'device-width',
  initialScale: 1,
  // Not 1: pinning maximumScale to 1 blocks pinch-zoom, which fails WCAG 1.4.4
  // and hurts exactly the people who need to enlarge a price or a time.
  maximumScale: 5,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  /*
   * ClerkProvider wraps the whole tree, including the admin group. That is
   * harmless: admin pages never render a Clerk component and never read a Clerk
   * session — the admin surface authenticates through Supabase email +
   * password and gates on the admin_users row. Wrapping here rather than only
   * in the public layout keeps a single provider, which is what Clerk's
   * client-side session hooks expect.
   */
  return (
    <ClerkProvider>
      <html lang="en-IN" className="bg-paper">
        <body className="min-h-screen bg-paper font-sans text-ink antialiased">
          {children}
        </body>
      </html>
    </ClerkProvider>
  )
}
