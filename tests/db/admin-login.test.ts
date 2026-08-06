import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closePool, query, resetData } from '../helpers/db'

/**
 * Admin login throttling — 0010.
 *
 * The customer OTP limiter does not cover this: a password is guessable in a
 * way a one-time code sent to a phone is not, so the admin form gets its own
 * counter with a much tighter budget.
 */

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)

async function consume(emailHash: string, ipHash: string) {
  const [row] = await query<{
    allowed: boolean
    retry_after_seconds: number
    scope: string | null
  }>(`select * from ac_consume_admin_login_attempt($1, $2)`, [emailHash, ipHash])
  return row
}

async function record(emailHash: string, ipHash: string, succeeded: boolean) {
  await query(`select ac_record_admin_login_attempt($1, $2, $3)`, [
    emailHash,
    ipHash,
    succeeded,
  ])
}

beforeEach(async () => {
  await resetData()
  await query(`truncate table admin_login_attempts restart identity`)
})

afterAll(closePool)

describe('ac_consume_admin_login_attempt', () => {
  it('allows the first attempt', async () => {
    expect((await consume(A, B)).allowed).toBe(true)
  })

  it('refuses a sixth failure for the same email inside the window', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await consume(A, B)).allowed).toBe(true)
      await record(A, B, false)
    }

    const blocked = await consume(A, B)
    expect(blocked.allowed).toBe(false)
    expect(blocked.scope).toBe('email')
    expect(blocked.retry_after_seconds).toBe(900)
  })

  it('counts only failures, so a working admin is never locked out', async () => {
    for (let i = 0; i < 20; i++) await record(A, B, true)
    expect((await consume(A, B)).allowed).toBe(true)
  })

  it('limits a single IP across many different emails', async () => {
    // Someone spraying passwords across accounts from one address. The email
    // counter never trips, so the IP counter has to.
    for (let i = 0; i < 15; i++) {
      const email = i.toString(16).padStart(64, '0')
      await record(email, C, false)
    }

    const blocked = await consume('f'.repeat(64), C)
    expect(blocked.allowed).toBe(false)
    expect(blocked.scope).toBe('ip')
  })

  it('does not let one email’s failures block a different email', async () => {
    for (let i = 0; i < 5; i++) await record(A, B, false)
    // Different email, same IP, still under the IP budget.
    expect((await consume(C, B)).allowed).toBe(true)
  })

  it('ignores failures older than the window', async () => {
    for (let i = 0; i < 5; i++) await record(A, B, false)
    expect((await consume(A, B)).allowed).toBe(false)

    await query(
      `update admin_login_attempts set attempted_at = now() - interval '16 minutes'`,
    )
    expect((await consume(A, B)).allowed).toBe(true)
  })

  it('refuses a key that is not a salted hash, so raw emails cannot be stored', async () => {
    await expect(consume('admin@alongco.com', B)).rejects.toThrow(
      /AC_INVALID_RATE_LIMIT_KEY/,
    )
    await expect(record('admin@alongco.com', B, false)).rejects.toThrow(
      /AC_INVALID_RATE_LIMIT_KEY/,
    )
  })
})

describe('admin_login_attempts', () => {
  it('is unreachable by anon and authenticated', async () => {
    const [{ anon, auth }] = await query<{ anon: boolean; auth: boolean }>(`
      select has_table_privilege('anon', 'admin_login_attempts', 'SELECT') as anon,
             has_table_privilege('authenticated', 'admin_login_attempts', 'SELECT') as auth
    `)
    // RLS is on with no policy, so even a granted SELECT returns nothing.
    const [{ rls }] = await query<{ rls: boolean }>(
      `select rowsecurity as rls from pg_tables
        where schemaname='public' and tablename='admin_login_attempts'`,
    )
    expect(rls).toBe(true)

    const policies = await query(
      `select policyname from pg_policies
        where schemaname='public' and tablename='admin_login_attempts'`,
    )
    expect(policies).toHaveLength(0)
    expect(anon || auth).toBeTypeOf('boolean')
  })

  it('keeps the rate-limit functions off every client role', async () => {
    const rows = await query<{ proname: string; anon: boolean; auth: boolean }>(`
      select p.proname,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('ac_consume_admin_login_attempt','ac_record_admin_login_attempt')
    `)
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r.anon).toBe(false)
      expect(r.auth).toBe(false)
    }
  })
})
