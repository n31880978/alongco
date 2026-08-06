import * as React from 'react'
import { cn } from '@/lib/utils'

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-12 w-full rounded-lg border border-ink/15 bg-white px-[13px] font-sans text-[14.5px] text-ink',
      'placeholder:text-ink/35',
      'focus:border-blue focus:outline-none focus:ring-[3px] focus:ring-blue/10',
      'disabled:bg-paper disabled:text-ink/60',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'min-h-[62px] w-full rounded-lg border border-ink/15 bg-white px-[13px] py-[11px] font-sans text-[13.5px] leading-[1.45] text-ink',
      'placeholder:text-ink/35',
      'focus:border-blue focus:outline-none focus:ring-[3px] focus:ring-blue/10',
      className,
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

export function FieldLabel({
  children,
  hint,
  className,
  htmlFor,
}: {
  children: React.ReactNode
  hint?: React.ReactNode
  className?: string
  htmlFor?: string
}) {
  return (
    <div className={cn('mb-1.5 flex items-baseline justify-between gap-3', className)}>
      <label htmlFor={htmlFor} className="font-sans text-[11px] font-semibold text-ink">
        {children}
      </label>
      {hint}
    </div>
  )
}

export function FieldHelp({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-[5px] font-sans text-[11.5px] leading-[1.45] text-ink/50">{children}</p>
  )
}

/**
 * Errors on the slot and payment paths must say what actually happened
 * (CLAUDE.md §6), so this renders the message it is given, never a generic one.
 */
export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="mt-[5px] font-sans text-[11.5px] leading-[1.45] text-rose-deep">
      {children}
    </p>
  )
}

export function Eyebrow({
  children,
  tone = 'muted',
  className,
}: {
  children: React.ReactNode
  tone?: 'muted' | 'blue' | 'rose' | 'paper'
  className?: string
}) {
  return (
    <div
      className={cn(
        'font-mono text-[9px] font-semibold uppercase tracking-[0.12em]',
        tone === 'muted' && 'text-ink/45',
        tone === 'blue' && 'text-blue',
        tone === 'rose' && 'text-rose-deep',
        tone === 'paper' && 'text-blue-soft',
        className,
      )}
    >
      {children}
    </div>
  )
}
