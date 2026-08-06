'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { FieldError, FieldHelp } from '@/components/ui/field'
import { uploadCompanionPhoto, type CompanionState } from '../actions'

/**
 * Profile photograph. Uploaded through a server action on the service client —
 * neither storage bucket has an insert policy for a browser session.
 */
export function PhotoUpload({
  companionId,
  photoUrl,
}: {
  companionId: string
  photoUrl: string | null
}) {
  const [state, action] = useActionState<CompanionState, FormData>(
    uploadCompanionPhoto,
    {},
  )

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="companionId" value={companionId} />

      <div className="flex items-start gap-3">
        <div className="h-28 w-[84px] shrink-0 overflow-hidden rounded-lg border border-ink/10 bg-paper-sunk">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- admin preview only
            <img
              src={photoUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center px-1 text-center font-mono text-[8.5px] leading-tight text-ink/35">
              NO PHOTO
            </div>
          )}
        </div>
        <div className="flex-1">
          <input
            type="file"
            name="photo"
            accept="image/jpeg,image/png,image/webp"
            required
            className="w-full font-sans text-[12.5px] text-ink file:mr-2 file:rounded-md file:border file:border-ink/15 file:bg-white file:px-2.5 file:py-1.5 file:font-sans file:text-[12px] file:font-semibold file:text-ink"
          />
          <FieldHelp>
            A current photograph, 3:4 portrait. JPEG, PNG or WebP under 5 MB. This bucket
            is public — the filename is replaced on upload so it cannot leak a real name.
          </FieldHelp>
        </div>
      </div>

      <FieldError>{state.error}</FieldError>
      {state.ok && (
        <p role="status" className="text-[13px] font-semibold text-green">
          Photograph updated.
        </p>
      )}
      <Submit />
    </form>
  )
}

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending} className="self-start">
      {pending ? 'Uploading…' : 'Upload photograph'}
    </Button>
  )
}
