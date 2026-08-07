import { describe, expect, it } from 'vitest'
import { emailSchema, isDisposableEmail, maskEmail } from '@/lib/auth/email'

/**
 * Email is now both the login and the channel the ticket arrives on, so a bad
 * address is not a validation nicety — it is a paid booking we cannot confirm.
 */

describe('emailSchema', () => {
  it('accepts an ordinary address and normalises it', () => {
    const parsed = emailSchema.parse('  Ananya.Rao@Gmail.com ')
    // Lower-cased and trimmed, because customers.email is uniquely indexed on
    // lower(email) — two casings must not become two accounts.
    expect(parsed).toBe('ananya.rao@gmail.com')
  })

  it('accepts a plus-addressed inbox', () => {
    expect(emailSchema.parse('ananya+alongco@gmail.com')).toBe(
      'ananya+alongco@gmail.com',
    )
  })

  it('rejects a malformed address', () => {
    expect(emailSchema.safeParse('ananya@').success).toBe(false)
    expect(emailSchema.safeParse('not an email').success).toBe(false)
    expect(emailSchema.safeParse('').success).toBe(false)
  })

  it('rejects a throwaway inbox with a message that says what to do', () => {
    const result = emailSchema.safeParse('someone@mailinator.com')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/temporary inbox/i)
    }
  })

  it('rejects a throwaway inbox regardless of casing', () => {
    expect(emailSchema.safeParse('Someone@MAILINATOR.com').success).toBe(false)
  })

  /**
   * The failure that matters more than letting a throwaway through: refusing a
   * real customer. Every one of these is a normal address that a naive
   * substring or keyword check would wrongly reject.
   */
  it('does not reject real providers that resemble blocked ones', () => {
    for (const address of [
      'a@gmail.com',
      'a@mail.com',
      'a@protonmail.com',
      'a@tempo.example.com',
      'a@mytrashmailservice.co.in',
      'a@yopmailer.com',
      'a@10minutemealsblog.com',
    ]) {
      expect(emailSchema.safeParse(address).success, address).toBe(true)
    }
  })
})

describe('isDisposableEmail', () => {
  it('matches only the exact domain, not a substring of it', () => {
    expect(isDisposableEmail('a@mailinator.com')).toBe(true)
    // A subdomain-looking lookalike is a different domain and must pass.
    expect(isDisposableEmail('a@notmailinator.com')).toBe(false)
    expect(isDisposableEmail('a@mailinator.com.example.org')).toBe(false)
  })

  it('is safe on input with no domain at all', () => {
    expect(isDisposableEmail('no-at-sign')).toBe(false)
    expect(isDisposableEmail('')).toBe(false)
  })
})

describe('maskEmail', () => {
  it('shows enough to recognise the address but not all of it', () => {
    const masked = maskEmail('ananya.rao@gmail.com')
    expect(masked.startsWith('a')).toBe(true)
    expect(masked.endsWith('@gmail.com')).toBe(true)
    expect(masked).not.toContain('nanya.ra')
  })

  it('handles a very short local part without exposing it whole', () => {
    expect(maskEmail('ab@gmail.com')).toBe('a•@gmail.com')
  })

  it('returns the input unchanged when there is no domain to mask around', () => {
    expect(maskEmail('malformed')).toBe('malformed')
  })
})
