'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input, Textarea, FieldLabel, FieldHelp, FieldError } from '@/components/ui/field'
import { createCompanion, updateCompanion, type CompanionState } from '../actions'

/**
 * Create and edit. The same fields either way — a companion that cannot be
 * edited into the shape a new one starts in would be a trap.
 *
 * Note what is absent: nothing here says "verified", "screened" or
 * "background-checked" (CLAUDE.md §3.7). Vetting lives in the identity panel,
 * which is a separate role and never reaches a public query.
 */
export function CompanionForm({
  areas,
  companion,
}: {
  areas: { id: string; name: string }[]
  companion?: {
    id: string
    slug: string
    displayName: string
    bio: string | null
    hourlyRatePaise: number
    areas: { id: string }[]
  }
}) {
  const editing = Boolean(companion)
  const [state, action] = useActionState<CompanionState, FormData>(
    editing ? updateCompanion : createCompanion,
    {},
  )

  const selected = new Set((companion?.areas ?? []).map((a) => a.id))

  return (
    <form action={action} className="flex flex-col gap-4">
      {companion && <input type="hidden" name="id" value={companion.id} />}

      <div>
        <FieldLabel htmlFor="displayName">Pseudonym</FieldLabel>
        <Input
          id="displayName"
          name="displayName"
          defaultValue={companion?.displayName ?? ''}
          maxLength={60}
          required
          placeholder="Arjun R."
        />
        <FieldHelp>
          The only name a customer ever sees. His real name goes in the identity panel.
        </FieldHelp>
      </div>

      <div>
        <FieldLabel htmlFor="slug">URL slug</FieldLabel>
        <Input
          id="slug"
          name="slug"
          defaultValue={companion?.slug ?? ''}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          required
          placeholder="arjun-r"
          className="font-mono"
        />
        <FieldHelp>alongco.com/c/<span className="font-mono">slug</span></FieldHelp>
      </div>

      <div>
        <FieldLabel htmlFor="bio">Bio</FieldLabel>
        <Textarea
          id="bio"
          name="bio"
          rows={4}
          maxLength={600}
          defaultValue={companion?.bio ?? ''}
          placeholder="Quiet company, and comfortable with silence…"
        />
        <FieldHelp>Written in his voice, first person. Under 600 characters.</FieldHelp>
      </div>

      <div>
        <FieldLabel htmlFor="hourlyRateRupees">Hourly rate</FieldLabel>
        <Input
          id="hourlyRateRupees"
          name="hourlyRateRupees"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          required
          defaultValue={companion ? companion.hourlyRatePaise / 100 : 499}
          className="font-mono"
        />
        <FieldHelp>
          Whole rupees. Bookings already made keep the price they were quoted.
        </FieldHelp>
      </div>

      <fieldset>
        <legend className="mb-1.5 block font-sans text-[13px] font-semibold text-ink">
          Areas he covers
        </legend>
        <div className="flex flex-wrap gap-2">
          {areas.map((area) => (
            <label
              key={area.id}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-ink/15 bg-white px-3 py-2 text-[13px] text-ink hover:bg-paper-warm"
            >
              <input
                type="checkbox"
                name="areaIds"
                value={area.id}
                defaultChecked={selected.has(area.id)}
                className="h-4 w-4 accent-[#2E63E8]"
              />
              {area.name}
            </label>
          ))}
        </div>
        <FieldHelp>At least one.</FieldHelp>
      </fieldset>

      <FieldError>{state.error}</FieldError>
      {state.ok && (
        <p role="status" className="text-[13px] font-semibold text-green">
          Saved.
        </p>
      )}

      <Submit editing={editing} />
    </form>
  )
}

function Submit({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="ink" size="md" disabled={pending} className="self-start">
      {pending ? 'Saving…' : editing ? 'Save changes' : 'Create companion'}
    </Button>
  )
}
