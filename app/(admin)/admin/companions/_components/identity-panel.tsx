'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input, Textarea, FieldLabel, FieldHelp, FieldError } from '@/components/ui/field'
import { saveIdentity, type CompanionState } from '../actions'

/**
 * The restricted identity panel. Owner role only (CLAUDE.md §3.6).
 *
 * Nothing typed here is ever revalidated onto a public path, joined into a
 * client-facing query, or written to the audit metadata. The page that renders
 * this component checks the role before it is reached — this is the editor, not
 * the gate.
 */
export function IdentityPanel({
  companionId,
  identity,
}: {
  companionId: string
  identity: {
    legal_name: string
    phone: string
    vetting_notes: string | null
    vetted_at: string | null
    agreement_signed_at: string | null
  } | null
}) {
  const [state, action] = useActionState<CompanionState, FormData>(saveIdentity, {})

  return (
    <form action={action} className="flex flex-col gap-3.5">
      <input type="hidden" name="companionId" value={companionId} />

      <div className="rounded-lg border border-rose-deep/25 bg-rose-tint px-3 py-2">
        <p className="text-[12px] leading-[1.45] text-ink/75">
          Restricted. These fields never appear in a customer-facing query, an API
          response, a ticket or a log line. Do not paste any of it into the WhatsApp
          templates.
        </p>
      </div>

      <div>
        <FieldLabel htmlFor="legalName">Legal name</FieldLabel>
        <Input
          id="legalName"
          name="legalName"
          defaultValue={identity?.legal_name ?? ''}
          required
          autoComplete="off"
        />
      </div>

      <div>
        <FieldLabel htmlFor="phone">Phone</FieldLabel>
        <Input
          id="phone"
          name="phone"
          defaultValue={identity?.phone ?? ''}
          required
          inputMode="tel"
          autoComplete="off"
          className="font-mono"
        />
        <FieldHelp>Indian mobile. Stored as 91XXXXXXXXXX.</FieldHelp>
      </div>

      <div>
        <FieldLabel htmlFor="vettingNotes">Vetting notes</FieldLabel>
        <Textarea
          id="vettingNotes"
          name="vettingNotes"
          rows={4}
          maxLength={2000}
          defaultValue={identity?.vetting_notes ?? ''}
          placeholder="Who met him, what was checked, what was seen."
        />
        <FieldHelp>
          Internal record of what was actually checked. We do not run background checks
          and never describe him as verified.
        </FieldHelp>
      </div>

      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          name="agreementSigned"
          defaultChecked={Boolean(identity?.agreement_signed_at)}
          className="mt-0.5 h-4 w-4 accent-[#2E63E8]"
        />
        <span className="text-[13px] leading-[1.45] text-ink">
          Conduct agreement signed
          <span className="block text-[12px] text-ink/55">
            He may not be listed without this. It is what makes his authority to end a
            booking enforceable.
          </span>
        </span>
      </label>

      <FieldError>{state.error}</FieldError>
      {state.ok && (
        <p role="status" className="text-[13px] font-semibold text-green">
          Identity record saved.
        </p>
      )}

      <Submit />
    </form>
  )
}

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="ink" size="sm" disabled={pending} className="self-start">
      {pending ? 'Saving…' : 'Save identity record'}
    </Button>
  )
}
