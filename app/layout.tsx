import type { Metadata, Viewport } from 'next'
import './globals.css'

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
    <html lang="en" className="bg-paper">
      <body className="min-h-screen bg-paper font-sans text-ink antialiased">
        {children}
      </body>
    </html>
  )
}
