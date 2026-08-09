'use client'

import { useState, useId } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { FieldLabel, Input } from '@/components/ui/field'
import { cn } from '@/lib/utils'

/**
 * Step 2 — contact info only.
 *
 * On submit we push all values as URL search params to the preferences page.
 * No server action fires here — the hold is created when the customer
 * submits the final preferences step.
 */
export function ContactForm({
  preferencesBase,
  areas,
}: {
  /** Base URL for the preferences page, already includes m= and t= */
  preferencesBase: string
  areas: { id: string; name: string }[]
}) {
  const router = useRouter()
  const nameId = useId()
  const emailId = useId()
  const phoneId = useId()

  const [areaId, setAreaId] = useState(areas[0]?.id ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [consented, setConsented] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  function validate(fd: FormData) {
    const errs: Record<string, string> = {}
    const name = String(fd.get('fullName') ?? '').trim()
    const email = String(fd.get('email') ?? '').trim()
    const phone = String(fd.get('phone') ?? '').replace(/[^\d]/g, '')

    if (name.length < 2) errs.fullName = 'Enter your full name.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = 'Enter a valid email address.'
    if (!/^(91)?[6-9]\d{9}$/.test(phone)) errs.phone = 'Enter a 10-digit Indian mobile number.'

    return errs
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const errs = validate(fd)
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    setSubmitting(true)

    const phone = String(fd.get('phone') ?? '').replace(/[^\d]/g, '')
    const normalised = phone.length === 10 ? `91${phone}` : phone

    const q = new URLSearchParams(preferencesBase.split('?')[1] ?? '')
    q.set('name', String(fd.get('fullName') ?? ''))
    q.set('email', String(fd.get('email') ?? ''))
    q.set('phone', normalised)
    q.set('area', areaId)

    const base = preferencesBase.split('?')[0]
    router.push(`${base}?${q}`)
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="bg-white px-[18px] py-6">
      <div className="flex flex-col gap-5">
        {/* Full name */}
        <div>
          <FieldLabel htmlFor={nameId}>Full name</FieldLabel>
          <Input
            id={nameId}
            name="fullName"
            autoComplete="name"
            placeholder="Ananya Rao"
            aria-describedby={errors.fullName ? `${nameId}-err` : undefined}
            className={errors.fullName ? 'border-rose-deep focus:border-rose-deep focus:ring-rose-deep/10' : ''}
          />
          {errors.fullName ? (
            <p id={`${nameId}-err`} role="alert" className="mt-1.5 font-sans text-[11.5px] text-rose-deep">
              {errors.fullName}
            </p>
          ) : (
            <p className="mt-1.5 font-sans text-[11.5px] text-ink/45">
              Your first name is shared with your companion.
            </p>
          )}
        </div>

        {/* Email */}
        <div>
          <FieldLabel htmlFor={emailId}>Email address</FieldLabel>
          <Input
            id={emailId}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-describedby={errors.email ? `${emailId}-err` : undefined}
            className={errors.email ? 'border-rose-deep focus:border-rose-deep focus:ring-rose-deep/10' : ''}
          />
          {errors.email ? (
            <p id={`${emailId}-err`} role="alert" className="mt-1.5 font-sans text-[11.5px] text-rose-deep">
              {errors.email}
            </p>
          ) : (
            <p className="mt-1.5 font-sans text-[11.5px] text-ink/45">
              Your ticket arrives here.
            </p>
          )}
        </div>

        {/* Phone */}
        <div>
          <FieldLabel htmlFor={phoneId}>WhatsApp number</FieldLabel>
          <Input
            id={phoneId}
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            placeholder="98765 43210"
            className={cn(
              'font-mono tracking-wide',
              errors.phone ? 'border-rose-deep focus:border-rose-deep focus:ring-rose-deep/10' : '',
            )}
            aria-describedby={errors.phone ? `${phoneId}-err` : undefined}
          />
          {errors.phone ? (
            <p id={`${phoneId}-err`} role="alert" className="mt-1.5 font-sans text-[11.5px] text-rose-deep">
              {errors.phone}
            </p>
          ) : (
            <p className="mt-1.5 font-sans text-[11.5px] text-ink/45">
              We'll coordinate over WhatsApp.
            </p>
          )}
        </div>

        {/* Area — only when companion has multiple */}
        {areas.length > 1 && (
          <fieldset>
            <legend className="mb-2 font-sans text-[11px] font-semibold text-ink">
              Where would you like to meet?
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {areas.map((area) => (
                <button
                  key={area.id}
                  type="button"
                  onClick={() => setAreaId(area.id)}
                  className={cn(
                    'rounded-lg py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.05em] transition-colors',
                    area.id === areaId
                      ? 'bg-ink text-white shadow-sm'
                      : 'border border-ink/15 bg-paper text-ink/60 hover:border-blue/30 hover:text-ink',
                  )}
                >
                  {area.name}
                </button>
              ))}
            </div>
            <p className="mt-1.5 font-sans text-[11.5px] text-ink/45">
              You'll agree the exact spot over WhatsApp.
            </p>
          </fieldset>
        )}

        {/* Consent */}
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink/10 bg-paper px-4 py-3.5">
          <input
            type="checkbox"
            checked={consented}
            onChange={(e) => setConsented(e.target.checked)}
            required
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#2E63E8]"
          />
          <span className="font-sans text-[12px] leading-[1.55] text-ink/65">
            I agree to AlongCo holding my name, email and phone to arrange this booking.{' '}
            <a href="/policies/privacy" className="text-blue underline underline-offset-2">
              Privacy notice
            </a>
          </span>
        </label>
      </div>

      <div className="mt-6 space-y-2.5">
        <Button
          type="submit"
          size="lg"
          sheen
          disabled={!consented || submitting}
          className="w-full"
        >
          {submitting ? 'Continuing…' : 'Continue to preferences'}
        </Button>
        <p className="text-center font-sans text-[11.5px] text-ink/45">
          One more step before we hold your slot.
        </p>
      </div>
    </form>
  )
}
