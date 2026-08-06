'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { FieldError, FieldHelp, FieldLabel, Input } from '@/components/ui/field'
import { formatPhone } from '@/lib/auth/phone'
import { requestOtp, verifyOtp, type OtpState } from '../actions'

export function SignInForm({ next }: { next?: string }) {
  const [requestState, request] = useActionState<OtpState, FormData>(requestOtp, {})
  const [verifyState, verify] = useActionState<OtpState, FormData>(verifyOtp, {})

  const sent = requestState.sent || verifyState.sent
  const phone = verifyState.phone ?? requestState.phone

  if (!sent || !phone) {
    return (
      <form action={request} className="flex flex-col gap-4 bg-white px-[18px] py-5">
        <div>
          <FieldLabel htmlFor="phone">Mobile number</FieldLabel>
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            required
            autoFocus
            placeholder="98765 43210"
            defaultValue={requestState.phone ?? ''}
            className="font-mono"
          />
          <FieldHelp>
            Indian mobile numbers only. We do not ask for an email or an address.
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
    <div className="flex flex-col gap-4 bg-white px-[18px] py-5">
      <form action={verify} className="flex flex-col gap-4">
        <input type="hidden" name="phone" value={phone} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <div>
          <FieldLabel
            htmlFor="token"
            hint={
              <span className="font-mono text-[10px] font-medium text-ink/40">
                {formatPhone(phone)}
              </span>
            }
          >
            The code we sent on WhatsApp
          </FieldLabel>
          <Input
            id="token"
            name="token"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            autoFocus
            maxLength={8}
            placeholder="000000"
            className="text-center font-mono text-[20px] tracking-[0.4em]"
          />
          <FieldHelp>It expires in a few minutes.</FieldHelp>
          <FieldError>{verifyState.error}</FieldError>
        </div>
        <SubmitButton>Verify and continue</SubmitButton>
      </form>

      <form action={request}>
        <input type="hidden" name="phone" value={phone} />
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
