import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const original = process.env.CASHFREE_ENV

async function envFor(value: string | undefined) {
  if (value === undefined) delete process.env.CASHFREE_ENV
  else process.env.CASHFREE_ENV = value
  vi.resetModules()
  return import('@/lib/cashfree/client')
}

afterEach(() => {
  if (original === undefined) delete process.env.CASHFREE_ENV
  else process.env.CASHFREE_ENV = original
})

describe('cashfreeEnv', () => {
  it('defaults to sandbox when unset', async () => {
    const { cashfreeEnv } = await envFor(undefined)
    expect(cashfreeEnv()).toBe('sandbox')
  })

  it('reads production', async () => {
    const { cashfreeEnv, cashfreeBaseUrl } = await envFor('production')
    expect(cashfreeEnv()).toBe('production')
    expect(cashfreeBaseUrl()).toBe('https://api.cashfree.com/pg')
  })

  /**
   * The failure this guards against: a `.env` written as
   *   CASHFREE_ENV=production   # live
   * would fail a raw equality check and silently route real customers to the
   * sandbox, where their payment succeeds and no money ever arrives.
   */
  it('ignores a trailing inline comment rather than falling back to sandbox', async () => {
    const { cashfreeEnv } = await envFor('production   # live keys')
    expect(cashfreeEnv()).toBe('production')
  })

  it('tolerates surrounding whitespace and case', async () => {
    const { cashfreeEnv } = await envFor('  PRODUCTION  ')
    expect(cashfreeEnv()).toBe('production')
  })

  it('still resolves sandbox written with a comment', async () => {
    const { cashfreeEnv, cashfreeBaseUrl } = await envFor(
      'sandbox          # sandbox | production',
    )
    expect(cashfreeEnv()).toBe('sandbox')
    expect(cashfreeBaseUrl()).toBe('https://sandbox.cashfree.com/pg')
  })

  it('refuses a typo instead of quietly defaulting', async () => {
    const { cashfreeEnv } = await envFor('prod')
    expect(() => cashfreeEnv()).toThrow(/must be "sandbox" or "production"/)
  })
})
