import type { NextConfig } from 'next'
import { fileURLToPath } from 'node:url'

// Keep Turbopack and output tracing scoped to this repository. There is an
// unrelated pnpm lockfile higher in the home directory; allowing Next to infer
// that as the root produces misleading workspace warnings and broad tracing.
const projectRoot = fileURLToPath(new URL('.', import.meta.url))

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: {
    root: projectRoot,
  },
  outputFileTracingRoot: projectRoot,

  // Allow up to 5 MB in Server Action request bodies (photo uploads).
  // Default is 1 MB; companion photos can easily exceed that.
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },

  cacheLife: {
    short: {
      stale: 60,
      revalidate: 30,
      expire: 300,
    },
    medium: {
      stale: 300,
      revalidate: 60,
      expire: 3600,
    },
    long: {
      stale: 3600,
      revalidate: 300,
      expire: 86400,
    },
  },

  images: {
    // Companion photos live in the public companion-photos bucket. Nothing else
    // is allowed through the optimiser.
    remotePatterns: supabaseHost
      ? [
          {
            protocol: 'https',
            hostname: supabaseHost,
            pathname: '/storage/v1/object/public/companion-photos/**',
          },
        ]
      : [],
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          {
            // CSP for the payment flow.
            // - script-src: own origin + Razorpay Checkout.js + Clerk hosted JS
            //   + unsafe-inline needed by Next.js inline scripts (nonce-based
            //   CSP would require a custom Document; this is the pragmatic floor).
            // - frame-src: Razorpay checkout iframe + Clerk auth flows.
            // - img-src: own origin + data URIs (QR codes) + Supabase storage.
            // - connect-src: own origin + Supabase API + Clerk API + Razorpay.
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://*.clerk.accounts.dev https://clerk.alongco.com",
              "style-src 'self' 'unsafe-inline'",
              "frame-src https://api.razorpay.com https://*.clerk.accounts.dev https://clerk.alongco.com",
              "img-src 'self' data: blob: https://*.supabase.co",
              "connect-src 'self' https://*.supabase.co https://api.razorpay.com https://*.clerk.com https://*.clerk.dev",
              "font-src 'self' data:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
      {
        // A ticket is a private document. Never let a shared cache hold one.
        source: '/ticket/:path*',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
      {
        source: '/admin/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ]
  },
}

export default nextConfig
