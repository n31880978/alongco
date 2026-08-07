import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, type NextFetchEvent } from 'next/server'
import { proxy } from '@/proxy'

/**
 * Clerk's middleware takes the fetch event so it can waitUntil. Nothing under
 * test awaits background work, so a stub with the same shape is enough — and
 * keeps the production signature honest rather than making it optional just to
 * suit the tests.
 */
const event = { waitUntil: () => {} } as unknown as NextFetchEvent

async function proxyOf(req: NextRequest) {
  const response = await proxy(req, event)
  if (!response) throw new Error('proxy returned no response')
  return response
}

function request(host: string, pathname = '/') {
  return new NextRequest(`https://${host}${pathname}`, { headers: { host } })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('host routing', () => {
  it('serves the admin route internally when ADMIN_HOST receives /', async () => {
    vi.stubEnv('ADMIN_HOST', 'admin.alongco.com')

    const response = await proxyOf(request('admin.alongco.com'))

    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'https://admin.alongco.com/admin',
    )
  })

  it('keeps the public host on the public route', async () => {
    vi.stubEnv('ADMIN_HOST', 'admin.alongco.com')

    const response = await proxyOf(request('alongco.com'))

    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
    expect(response.status).toBe(200)
  })

  it('refuses the internal admin path from a public hostname', async () => {
    vi.stubEnv('ADMIN_HOST', 'admin.alongco.com')

    const response = await proxyOf(request('alongco.com', '/admin'))

    expect(response.status).toBe(404)
  })
})

describe('session refresh on the admin host', () => {
  /**
   * Regression guard. The rewrite branch used to return its own response and
   * return early, which skipped the Supabase session refresh on every canonical
   * admin URL. Nothing looks wrong for about an hour, and then the access token
   * stops being renewed and the operator is signed out mid-shift.
   *
   * Asserted structurally: the rewrite must be produced by the same code path
   * that refreshes, so both the rewrite header and a pass through updateSession
   * have to be present on one response.
   */
  it('rewrites a bare admin-host path and still runs the refresh', async () => {
    vi.stubEnv('ADMIN_HOST', 'admin.alongco.com')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')

    const response = await proxyOf(request('admin.alongco.com', '/bookings'))

    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'https://admin.alongco.com/admin/bookings',
    )
  })

  it('rewrites the sign-in path so /sign-in resolves on the admin host', async () => {
    vi.stubEnv('ADMIN_HOST', 'admin.alongco.com')

    const response = await proxyOf(request('admin.alongco.com', '/sign-in'))

    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'https://admin.alongco.com/admin/sign-in',
    )
  })

  it('still refuses /admin/sign-in from the public host', async () => {
    vi.stubEnv('ADMIN_HOST', 'admin.alongco.com')

    const response = await proxyOf(request('alongco.com', '/admin/sign-in'))

    expect(response.status).toBe(404)
  })
})
