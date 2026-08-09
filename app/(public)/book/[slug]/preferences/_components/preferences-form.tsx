'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { FieldLabel, Textarea } from '@/components/ui/field'
import { holdSlot, type HoldState } from '../../actions'

/**
 * Step 3 — preferences & notes.
 *
 * This is the form that fires holdSlot. All the contact fields collected on
 * the previous page arrive as props and are threaded through as hidden inputs,
 * so the server action receives a complete payload in one submission.
 */
export function PreferencesForm({
  slug,
  startsAt,
  durationMinutes,
  areaId,
  fullName,
  email,
  phone,
  companionName,
}: {
  slug: string
  startsAt: string
  durationMinutes: number
  areaId: string
  fullName: string
  email: string
  phone: string
  companionName: string
}) {
  const router = useRouter()
  const [state, submit] = useActionState<HoldState, FormData>(holdSlot, {})

  useEffect(() => {
    if (state.refresh) router.push(`/book/${slug}?m=${durationMinutes}`)
  }, [state.refresh, router, slug, durationMinutes])

  return (
    <form action={submit} className="bg-white px-[18px] py-6">
      {/* Carry all fields from previous steps */}
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="startsAt" value={startsAt} />
      <input type="hidden" name="durationMinutes" value={durationMinutes} />
      <input type="hidden" name="areaId" value={areaId} />
      <input type="hidden" name="fullName" value={fullName} />
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="phone" value={phone} />

      <div className="flex flex-col gap-6">
        {/* What are you looking for */}
        <div>
          <FieldLabel
            htmlFor="preferences"
            hint={
              <span className="rounded bg-paper-sunk px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-ink/40">
                Optional
              </span>
            }
          >
            What are you looking for?
          </FieldLabel>
          <Textarea
            id="preferences"
            name="preferences"
            maxLength={500}
            rows={4}
            placeholder={`A quiet walk, some good conversation, company at a gallery, a coffee and a chat — anything you'd enjoy with ${companionName}.`}
          />
          <p className="mt-1.5 font-sans text-[11.5px] leading-[1.45] text-ink/45">
            Helps {companionName} show up ready for you.
          </p>
        </div>

        {/* Anything they should know */}
        <div>
          <FieldLabel
            htmlFor="customerNotes"
            hint={
              <span className="rounded bg-paper-sunk px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-ink/40">
                Optional
              </span>
            }
          >
            Anything {companionName} should know?
          </FieldLabel>
          <Textarea
            id="customerNotes"
            name="customerNotes"
            maxLength={500}
            rows={4}
            placeholder="A topic you'd like to avoid, something that would make you more comfortable, accessibility needs, anything at all…"
          />
          <p className="mt-1.5 font-sans text-[11.5px] leading-[1.45] text-ink/45">
            This stays between you and {companionName}.
          </p>
        </div>

        {/* Reassurance card */}
        <div className="rounded-xl border border-ink/[.07] bg-paper px-4 py-3.5">
          <p className="font-mono text-[9px] font-semibold uppercase tracking-[.1em] text-ink/40">
            What happens next
          </p>
          <ul className="mt-2 space-y-1.5">
            {[
              `We hold your slot for 10 minutes while you pay.`,
              `${companionName} sees your preferences before you meet.`,
              `You coordinate the exact location over WhatsApp.`,
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <span className="mt-[5px] h-[5px] w-[5px] shrink-0 rounded-full bg-blue/50" aria-hidden />
                <span className="font-sans text-[12.5px] leading-[1.5] text-ink/65">{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Error */}
      {state.error && (
        <div
          role="alert"
          className="mt-5 rounded-xl border border-rose/25 bg-rose-tint px-4 py-3"
        >
          <p className="font-mono text-[9px] font-bold uppercase tracking-[.1em] text-rose-deep">
            Couldn't continue
          </p>
          <p className="mt-1 font-sans text-[12.5px] leading-[1.5] text-ink/80">{state.error}</p>
        </div>
      )}

      <div className="mt-6 space-y-2.5">
        <SubmitButton />
        <p className="text-center font-sans text-[11.5px] text-ink/45">
          Your slot is held for 10 minutes once you continue.
        </p>
      </div>
    </form>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      size="lg"
      sheen
      disabled={pending}
      className="w-full"
    >
      {pending ? 'Holding your time…' : 'Continue to secure payment'}
    </Button>
  )
}
