'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { FieldError, FieldHelp, FieldLabel, Input } from '@/components/ui/field'
import { maskEmail } from '@/lib/auth/email'
import { requestOtp, verifyOtp, type OtpState } from '../actions'

export function SignInForm({ next }: { next?: string }) {
  const [requestState, request] = useActionState<OtpState, FormData>(requestOtp, {})
  const [verifyState, verify] = useActionState<OtpState, FormData>(verifyOtp, {})

  const sent = requestState.sent || verifyState.sent
  const email = verifyState.email ?? requestState.email

  if (!sent || !email) {
    return (
      <form action={request} className="mx-auto flex w-full max-w-[560px] flex-col gap-4 bg-white px-[18px] py-5">
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
            defaultValue={requestState.email ?? ''}
          />
          <FieldHelp>
            We send a 6-digit code. Your number comes later, so we can confirm on
            WhatsApp.
          </FieldHelp>
          <FieldError>{requestState.error}</FieldError>
        </div>
        <SubmitButton>Send me a code</SubmitButton>
        <p className="font-sans text-[11.5px] leading-[1.5] text-ink/50">
          By continuing you agree to our{' '}
          <Link href="/policies/terms" className="text-blue">
            terms
          </Link>{' '}
          and{' '}
          <Link href="/policies/privacy" className="text-blue">
            privacy notice
          </Link>
          .
        </p>
      </form>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 bg-white px-[18px] py-5">
      <form action={verify} className="flex flex-col gap-4">
        <input type="hidden" name="email" value={email} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <div>
          <FieldLabel
            htmlFor="token"
            hint={
              <span className="font-mono text-[10px] font-medium text-ink/40">
                {maskEmail(email)}
              </span>
            }
          >
            The code we emailed you
          </FieldLabel>
          <Input
            id="token"
            name="token"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            autoFocus
            maxLength={6}
            placeholder="000000"
            className="text-center font-mono text-[20px] tracking-[0.4em]"
          />
          <FieldHelp>
            It expires in a few minutes. Check your spam folder if it has not
            arrived.
          </FieldHelp>
          <FieldError>{verifyState.error}</FieldError>
        </div>
        <SubmitButton>Verify and continue</SubmitButton>
      </form>

      <form action={request}>
        <input type="hidden" name="email" value={email} />
        <ResendButton />
      </form>
    </div>
  )
}

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" sheen disabled={pending} className="w-full">
      {pending ? 'One moment…' : children}
    </Button>
  )
}

function ResendButton() {
  const { pending } = useFormStatus()
  const [clicked, setClicked] = useState(false)
  return (
    <Button
      type="submit"
      variant="ghost"
      size="md"
      disabled={pending}
      onClick={() => setClicked(true)}
      className="w-full"
    >
      {pending ? 'Sending…' : clicked ? 'Send another code' : 'Send it again'}
    </Button>
  )
}
