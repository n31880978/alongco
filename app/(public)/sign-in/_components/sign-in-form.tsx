'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { FieldError, FieldHelp, FieldLabel, Input } from '@/components/ui/field'
import { requestSignInLink, type SignInState } from '../actions'

/**
 * Email in, confirmation link out. There is no code to type back — see
 * lib/auth/email.ts for why.
 */
export function SignInForm({ next }: { next?: string }) {
  const [state, submit] = useActionState<SignInState, FormData>(requestSignInLink, {})

  if (state.sent && state.email) {
    return <CheckYourInbox email={state.email} next={next} />
  }

  return (
    <form
      action={submit}
      className="mx-auto flex w-full max-w-[560px] flex-col gap-4 bg-white px-[18px] py-5"
    >
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div>
        <FieldLabel htmlFor="email">Email address</FieldLabel>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          autoFocus
          spellCheck={false}
          placeholder="you@example.com"
          defaultValue={state.email ?? ''}
          aria-describedby="email-help"
        />
        <FieldHelp>
          <span id="email-help">
            We send a link to confirm it is you. Your number comes later, so we can
            confirm the booking on WhatsApp.
          </span>
        </FieldHelp>
        <FieldError>{state.error}</FieldError>
      </div>

      <SubmitButton />

      <p className="font-sans text-[11.5px] leading-[1.5] text-ink/50">
        By continuing you agree to our{' '}
        <Link href="/policies/terms" className="text-blue underline underline-offset-2">
          terms
        </Link>{' '}
        and{' '}
        <Link href="/policies/privacy" className="text-blue underline underline-offset-2">
          privacy notice
        </Link>
        .
      </p>
    </form>
  )
}

/**
 * The waiting screen.
 *
 * It names the in-app-browser trap explicitly. She will not know that opening
 * the link from inside Gmail can land her in a different browser than the one
 * holding her slot — and if that happens without warning it reads as the site
 * being broken, which on a booking she is already nervous about is the moment
 * she leaves.
 */
function CheckYourInbox({ email, next }: { email: string; next?: string }) {
  const [state, submit] = useActionState<SignInState, FormData>(requestSignInLink, {})

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 bg-white px-[18px] py-5">
      <div className="rounded-xl border border-green/25 bg-green-tint px-4 py-3.5">
        <p className="mb-1 font-mono text-[9.5px] font-semibold tracking-[0.11em] text-green">
          EMAIL SENT
        </p>
        <p className="font-sans text-[14px] leading-[1.5] text-ink">
          Open the link we just sent to{' '}
          <strong className="font-semibold">{email}</strong>.
        </p>
      </div>

      <div className="rounded-lg border border-ink/10 bg-paper px-3.5 py-3">
        <p className="font-sans text-[12.5px] leading-[1.55] text-ink/70">
          <strong className="font-semibold text-ink">
            Open it in this same browser.
          </strong>{' '}
          If you tap the link inside the Gmail app it can open somewhere else, and you
          will land back here still signed out. Long-press the link and choose
          &ldquo;open in browser&rdquo; if that happens.
        </p>
      </div>

      <p className="font-sans text-[12.5px] leading-[1.55] text-ink/55">
        Nothing in your inbox after a minute or two? Check spam, or send it again.
      </p>

      <form action={submit} className="flex flex-col gap-2">
        <input type="hidden" name="email" value={email} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <FieldError>{state.error}</FieldError>
        {state.sent && !state.error && (
          <p role="status" className="font-sans text-[12.5px] font-semibold text-green">
            Sent again.
          </p>
        )}
        <ResendButton />
      </form>
    </div>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" sheen disabled={pending} className="w-full">
      {pending ? 'Sending…' : 'Email me a sign-in link'}
    </Button>
  )
}

function ResendButton() {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      variant="outline"
      size="md"
      disabled={pending}
      className="w-full"
    >
      {pending ? 'Sending…' : 'Send the link again'}
    </Button>
  )
}
