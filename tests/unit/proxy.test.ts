import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'

function request(host: string, pathname = '/') {
  return new NextRequest(`https://${host}${pathname}`, { headers: { host } })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('host routing', () => {
  it('serves the admin route internally when ADMIN_HOST receives /', async () => {
    vi.stubEnv('ADMIN_HOST', 'admin.alongco.com')

    const response = await proxy(request('admin.alongco.com'))

    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'https://admin.alongco.com/admin',
    )
  })

  it('keeps the public host on the public route', async () => {
    vi.stubEnv('ADMIN_HOST', 'admin.alongco.com')

    const response = await proxy(request('alongco.com'))

    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
    expect(response.status).toBe(200)
  })

  it('refuses the internal admin path from a public hostname', async () => {
    vi.stubEnv('ADMIN_HOST', 'admin.alongco.com')

    const response = await proxy(request('alongco.com', '/admin'))

    expect(response.status).toBe(404)
  })
})
