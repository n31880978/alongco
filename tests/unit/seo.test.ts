import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * siteUrl() must never throw.
 *
 * app/layout.tsx does `metadataBase: new URL(siteUrl())` at module scope, so a
 * value this function cannot parse does not degrade one page — it takes down
 * every route in the app-router module graph, robots.txt and sitemap.xml
 * included, while a bare route handler keeps answering 200. That is exactly the
 * signature production was showing.
 */

async function load() {
  vi.resetModules()
  return import('@/lib/seo')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('siteUrl', () => {
  it('uses the configured origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.alongco.com')
    const { siteUrl } = await load()
    expect(siteUrl()).toBe('https://www.alongco.com')
  })

  it('defaults to the www host when unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
    const { siteUrl } = await load()
    // www, not apex: the apex 308-redirects, so apex canonicals and payment
    // return URLs would all point at a redirect.
    expect(siteUrl()).toBe('https://www.alongco.com')
  })

  it('repairs a scheme-less value instead of throwing', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'www.alongco.com')
    const { siteUrl } = await load()
    expect(siteUrl()).toBe('https://www.alongco.com')
  })

  it('strips a path, query and trailing slash', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.alongco.com/some/path?a=1')
    const { siteUrl } = await load()
    expect(siteUrl()).toBe('https://www.alongco.com')
  })

  it('tolerates surrounding whitespace', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '  https://www.alongco.com  ')
    const { siteUrl } = await load()
    expect(siteUrl()).toBe('https://www.alongco.com')
  })

  it('falls back rather than throwing on an unparseable value', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://')
    const { siteUrl } = await load()
    expect(siteUrl()).toBe('https://www.alongco.com')
  })

  /**
   * The actual regression guard: whatever is in the environment, the value must
   * survive `new URL()`, because that call happens at module scope in the root
   * layout.
   */
  it('always returns something new URL() accepts', async () => {
    for (const value of [
      '',
      'alongco.com',
      'www.alongco.com',
      'https://www.alongco.com',
      'http://localhost:3000',
      'https://alongco.com/',
      '   ',
      'not a url at all',
      'http://',
      'ftp://alongco.com',
    ]) {
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', value)
      const { siteUrl } = await load()
      expect(() => new URL(siteUrl()), `input: ${JSON.stringify(value)}`).not.toThrow()
    }
  })

  it('keeps localhost usable for development', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000')
    const { siteUrl } = await load()
    expect(siteUrl()).toBe('http://localhost:3000')
  })
})

describe('absoluteUrl', () => {
  it('joins a path onto the origin exactly once', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.alongco.com')
    const { absoluteUrl } = await load()
    expect(absoluteUrl('/companions')).toBe('https://www.alongco.com/companions')
    expect(absoluteUrl('companions')).toBe('https://www.alongco.com/companions')
  })
})
