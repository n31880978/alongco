'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Copies a prepared message to the clipboard.
 *
 * The message text is passed in from the server already composed — this
 * component never assembles copy of its own, so there is exactly one wording
 * for each template (lib/whatsapp/message-templates.ts).
 */
export function CopyButton({
  text,
  label = 'Copy message',
  className,
}: {
  text: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  React.useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard permission denied, or an insecure origin. Fall back to a
      // selection the operator can copy by hand rather than failing silently.
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      try {
        document.execCommand('copy')
      } finally {
        document.body.removeChild(area)
      }
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-live="polite"
      className={cn(
        'h-9 rounded-lg border px-3 font-sans text-[12.5px] font-semibold transition-colors',
        copied
          ? 'border-green/30 bg-green-tint text-green'
          : 'border-ink/15 bg-white text-ink hover:bg-paper-warm',
        className,
      )}
    >
      {copied ? 'Copied' : label}
    </button>
  )
}
