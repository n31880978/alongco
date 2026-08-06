import type { Metadata, Viewport } from 'next'
import { Public_Sans, Newsreader } from 'next/font/google'
import './globals.css'

const publicSans = Public_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-public-sans',
  display: 'swap',
})

// Display headings only (CLAUDE.md §5).
const newsreader = Newsreader({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-newsreader',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? 'https://alongco.com',
  ),
  title: {
    default: 'AlongCo — meaningful company, on your terms',
    template: '%s · AlongCo',
  },
  description:
    'Book an hour of company in a public place in Bangalore. No romance, no obligation, a clear price and a clear way to end it.',
}

export const viewport: Viewport = {
  themeColor: '#FBFAF7',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${publicSans.variable} ${newsreader.variable}`}>
      <body>{children}</body>
    </html>
  )
}
