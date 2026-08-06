'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { FieldError, FieldHelp, FieldLabel, Input, Textarea } from '@/components/ui/field'
import { CONSENT_NOTICE } from '@/lib/booking/terms'
import { cn } from '@/lib/utils'
import { saveDetails, type DetailsState } from '../actions'

export function DetailsForm({
  slug,
  bookingId,
  maskedEmail,
  defaultName,
  defaultPhone,
  defaultAreaId,
  defaultNotes,
  areas,
  companionName,
  amountLabel,
  alreadyConsented,
}: {
  slug: string
  bookingId: string
  maskedEmail: string
  defaultName: string
  defaultPhone: string
  defaultAreaId: string
  defaultNotes: string
  areas: { id: string; name: string }[]
  companionName: string
  amountLabel: string
  alreadyConsented: boolean
}) {
  const [state, submit] = useActionState<DetailsState, FormData>(saveDetails, {})
  const [areaId, setAreaId] = useState(defaultAreaId || (areas[0]?.id ?? ''))
  const [consented, setConsented] = useState(alreadyConsented)

  return (
    <form action={submit} className="flex flex-col gap-[17px] bg-white px-[18px] py-4">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="areaId" value={areaId} />

      <div>
        <FieldLabel
          hint={
            <span className="rounded-[3px] bg-green-tint px-1.5 py-[3px] font-mono text-[9px] font-semibold text-green">
              VERIFIED
            </span>
          }
        >
          Email
        </FieldLabel>
        <div className="flex h-12 items-center rounded-lg border border-ink/15 bg-paper px-[13px] font-sans text-[14.5px] font-medium text-ink">
          {maskedEmail}
        </div>
        <FieldHelp>The address you signed in with.</FieldHelp>
      </div>

      <div>
        <FieldLabel htmlFor="phone">Your WhatsApp number</FieldLabel>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          required
          defaultValue={defaultPhone.replace(/^91/, '')}
          placeholder="98765 43210"
          className="font-mono"
        />
        <FieldHelp>
          Indian mobile numbers only. This is where we send your confirmation within
          fifteen minutes, so please check it — a wrong digit means we cannot reach you.
        </FieldHelp>
      </div>

      <div>
        <FieldLabel htmlFor="fullName">Your full name</FieldLabel>
        <Input
          id="fullName"
          name="fullName"
          required
          autoComplete="name"
          defaultValue={defaultName}
          placeholder="Ananya Rao"
        />
        <FieldHelp>
          {companionName} is told your first name only. The rest stays with us.
        </FieldHelp>
      </div>

      <fieldset>
        <legend className="mb-1.5 font-sans text-[11px] font-semibold text-ink">
          Where you want to meet
        </legend>
        <div className="flex gap-1.5">
          {areas.map((a) => (
            <button
              key={a.id}
              type="button"
              aria-pressed={areaId === a.id}
              onClick={() => setAreaId(a.id)}
              className={cn(
                'flex-1 rounded-[7px] py-[11px] text-center font-mono text-[10.5px] font-semibold uppercase transition-colors',
                areaId === a.id
                  ? 'bg-ink text-white'
                  : 'border border-blue/20 bg-blue-tint text-blue-dark',
              )}
            >
              {a.name}
            </button>
          ))}
        </div>
        <FieldHelp>
          {companionName} covers {formatList(areas.map((a) => a.name))}. You pick the exact
          place over WhatsApp.
        </FieldHelp>
      </fieldset>

      <div>
        <FieldLabel
          htmlFor="notes"
          hint={
            <span className="font-mono text-[10px] font-medium text-ink/40">OPTIONAL</span>
          }
        >
          Anything he should know
        </FieldLabel>
        <Textarea
          id="notes"
          name="notes"
          maxLength={500}
          defaultValue={defaultNotes}
          placeholder="I'd rather not talk much — I want to see the exhibition."
        />
      </div>

      <label className="flex gap-2.5 rounded-lg bg-blue-tint px-[13px] py-3">
        <input
          type="checkbox"
          name="consent"
          checked={consented}
          onChange={(e) => setConsented(e.target.checked)}
          required
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#2E63E8]"
        />
        <span className="font-sans text-[11.5px] leading-[1.5] text-ink/70">
          {CONSENT_NOTICE}{' '}
          <Link href="/policies/privacy" className="text-blue underline">
            Privacy notice
          </Link>
        </span>
      </label>

      <FieldError>{state.error}</FieldError>

      <SubmitButton amountLabel={amountLabel} disabled={!consented || !areaId} />
    </form>
  )
}

function SubmitButton({
  amountLabel,
  disabled,
}: {
  amountLabel: string
  disabled: boolean
}) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" sheen disabled={disabled || pending} className="w-full">
      {pending ? 'Saving…' : `Review and pay · ${amountLabel}`}
    </Button>
  )
}

function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
