import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asRole, closePool, resetData } from '../helpers/db'

const PHONE_HASH = 'a'.repeat(64)
const IP_HASH = 'b'.repeat(64)

describe('OTP rate limit', () => {
  beforeEach(resetData)
  afterAll(closePool)

  it('refuses the sixth OTP request for a phone number in one minute', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 6 }, () =>
        asRole('anon', null, (client) =>
          client
            .query(
              'select * from ac_consume_otp_rate_limit($1, $2)',
              [PHONE_HASH, IP_HASH],
            )
            .then((result) => result.rows[0]),
        ),
      ),
    )

    expect(attempts.filter((attempt) => attempt.allowed)).toHaveLength(5)
    expect(attempts.filter((attempt) => !attempt.allowed)).toEqual([
      expect.objectContaining({
      allowed: false,
      retry_after_seconds: 60,
      scope: 'phone',
      }),
    ])
  })
})
