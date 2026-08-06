'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { submitReview, type ReviewFormState } from '../actions'

/**
 * One review per completed booking.
 *
 * No incentive, no nudge, no pre-filled five stars — the whole value of these
 * is that the next woman reading them can trust they are real.
 */
export function ReviewForm({
  bookingId,
  companionName,
}: {
  bookingId: string
  companionName: string
}) {
  const [state, action] = useActionState<ReviewFormState, FormData>(submitReview, {})
  const [rating, setRating] = React.useState(0)

  if (state.ok) {
    return (
      <div className="rounded-[10px] border border-green/30 bg-green-tint p-4">
        <p className="font-sans text-[14px] font-semibold text-green">Review received</p>
        <p className="mt-1 font-sans text-[13px] leading-[1.5] text-ink/70">{state.ok}</p>
      </div>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="rating" value={rating} />

      <fieldset>
        <legend className="mb-2 font-sans text-[13px] font-semibold text-ink">
          How was the hour with {companionName}?
        </legend>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              aria-pressed={rating === n}
              aria-label={`${n} out of 5`}
              className={
                'h-11 flex-1 rounded-lg border font-mono text-[15px] font-semibold transition-colors ' +
                (rating >= n && rating > 0
                  ? 'border-blue bg-blue text-white'
                  : 'border-ink/15 bg-white text-ink/45 hover:bg-paper-warm')
              }
            >
              {n}
            </button>
          ))}
        </div>
        <p className="mt-1.5 font-sans text-[11.5px] text-ink/50">
          1 is poor, 5 is excellent.
        </p>
      </fieldset>

      <div>
        <label
          htmlFor="body"
          className="mb-1.5 block font-sans text-[13px] font-semibold text-ink"
        >
          Anything you want to say
          <span className="ml-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-ink/40">
            optional
          </span>
        </label>
        <textarea
          id="body"
          name="body"
          rows={5}
          maxLength={1500}
          placeholder="What another woman deciding whether to book him would want to know."
          className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2.5 font-sans text-[13.5px] leading-[1.5] text-ink placeholder:text-ink/35 focus:border-blue focus:outline-none focus:ring-[3px] focus:ring-blue/10"
        />
        <p className="mt-1.5 font-sans text-[11.5px] leading-[1.45] text-ink/50">
          Your first initial and the area are shown. Your name and number are not.
        </p>
      </div>

      <FieldError>{state.error}</FieldError>
      <Submit disabled={rating === 0} />
    </form>
  )
}

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="primary" size="lg" disabled={pending || disabled} sheen>
      {pending ? 'Sending…' : 'Leave this review'}
    </Button>
  )
}
