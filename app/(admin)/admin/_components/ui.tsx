import Link from 'next/link'
import { cn } from '@/lib/utils'
import { formatPaise } from '@/lib/booking/pricing'
import type { BookingStatus } from '@/lib/supabase/types'

/**
 * Operator-density primitives. The admin canvas is the same palette as the
 * public site but tighter: hairline tables, monospace for money and references,
 * no decoration that does not carry information.
 */

export function PageHeader({
  eyebrow,
  title,
  meta,
  action,
}: {
  eyebrow?: string
  title: string
  meta?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && (
          <p className="mb-1.5 font-mono text-[10px] font-semibold tracking-[0.13em] text-ink/40">
            {eyebrow}
          </p>
        )}
        <h1 className="font-serif text-[30px] font-light leading-[1.1] tracking-[-0.02em] text-ink">
          {title}
        </h1>
        {meta && <div className="mt-1.5 text-[13px] text-ink/60">{meta}</div>}
      </div>
      {action}
    </div>
  )
}

export function Card({
  children,
  className,
  tone = 'default',
  id,
}: {
  children: React.ReactNode
  className?: string
  tone?: 'default' | 'warning' | 'danger' | 'success'
  /** Anchor target, so a booking can link straight to its incident. */
  id?: string
}) {
  const tones = {
    default: 'border-ink/10 bg-paper',
    warning: 'border-amber/25 bg-amber-tint',
    danger: 'border-rose-deep/25 bg-rose-tint',
    success: 'border-green/25 bg-green-tint',
  }
  return (
    <section
      id={id}
      className={cn('scroll-mt-24 rounded-xl border p-4 md:p-5', tones[tone], className)}
    >
      {children}
    </section>
  )
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 font-mono text-[10px] font-semibold tracking-[0.13em] text-ink/45">
      {children}
    </h2>
  )
}

export function Stat({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: React.ReactNode
  detail?: React.ReactNode
  tone?: 'default' | 'warning' | 'danger'
}) {
  return (
    <div
      className={cn(
        'rounded-xl border p-4',
        tone === 'warning'
          ? 'border-amber/25 bg-amber-tint'
          : tone === 'danger'
            ? 'border-rose-deep/25 bg-rose-tint'
            : 'border-ink/10 bg-paper',
      )}
    >
      <p className="font-mono text-[10px] font-semibold tracking-[0.11em] text-ink/45">
        {label}
      </p>
      <p className="mt-1.5 font-serif text-[28px] font-light leading-none text-ink">
        {value}
      </p>
      {detail && <p className="mt-1.5 text-[12px] text-ink/55">{detail}</p>}
    </div>
  )
}

/** Money is always monospace, always from paise. Never re-derived in the UI. */
export function Money({ paise, className }: { paise: number; className?: string }) {
  return (
    <span className={cn('font-mono text-[13px] font-semibold text-ink', className)}>
      {formatPaise(paise)}
    </span>
  )
}

export function Ref({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[12.5px] font-semibold tracking-[0.02em] text-ink">
      {children}
    </span>
  )
}

const STATUS_LABEL: Record<BookingStatus, string> = {
  pending_payment: 'HELD',
  confirmed: 'CONFIRMED',
  completed: 'COMPLETED',
  cancelled_by_customer: 'CANCELLED',
  cancelled_by_admin: 'CANCELLED',
  ended_early: 'ENDED EARLY',
  no_show_customer: 'NO-SHOW',
  no_show_companion: 'NO-SHOW',
  expired: 'EXPIRED',
}

const STATUS_TONE: Record<BookingStatus, string> = {
  pending_payment: 'border-amber/30 bg-amber-tint text-amber',
  confirmed: 'border-green/30 bg-green-tint text-green',
  completed: 'border-ink/15 bg-paper-sunk text-ink/70',
  cancelled_by_customer: 'border-ink/15 bg-paper-sunk text-ink/55',
  cancelled_by_admin: 'border-ink/15 bg-paper-sunk text-ink/55',
  ended_early: 'border-rose-deep/30 bg-rose-tint text-rose-deep',
  no_show_customer: 'border-rose-deep/30 bg-rose-tint text-rose-deep',
  no_show_companion: 'border-rose-deep/30 bg-rose-tint text-rose-deep',
  expired: 'border-ink/15 bg-paper-sunk text-ink/45',
}

export function StatusPill({ status }: { status: BookingStatus }) {
  return (
    <span
      className={cn(
        'inline-block whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[9.5px] font-semibold tracking-[0.08em]',
        STATUS_TONE[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'blue' | 'green' | 'amber' | 'rose'
}) {
  const tones = {
    neutral: 'border-ink/15 bg-paper-sunk text-ink/60',
    blue: 'border-blue/25 bg-blue-tint text-blue-dark',
    green: 'border-green/30 bg-green-tint text-green',
    amber: 'border-amber/30 bg-amber-tint text-amber',
    rose: 'border-rose-deep/30 bg-rose-tint text-rose-deep',
  }
  return (
    <span
      className={cn(
        'inline-block whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[9.5px] font-semibold tracking-[0.08em]',
        tones[tone],
      )}
    >
      {children}
    </span>
  )
}

/** Hairline table. Scrolls on its own rather than pushing the page sideways. */
export function Table({
  head,
  children,
}: {
  head: React.ReactNode[]
  children: React.ReactNode
}) {
  return (
    <div className="ac-scroll-x overflow-hidden rounded-xl border border-ink/10 bg-paper">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="border-b border-ink/10 bg-paper-warm">
            {head.map((h, i) => (
              <th
                key={i}
                className="px-3 py-2.5 font-mono text-[9.5px] font-semibold tracking-[0.1em] text-ink/45"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function Row({ children }: { children: React.ReactNode }) {
  return (
    <tr className="border-b border-ink/[.07] text-[13px] last:border-0 hover:bg-paper-warm">
      {children}
    </tr>
  )
}

export function Cell({
  children,
  className,
}: {
  children?: React.ReactNode
  className?: string
}) {
  return <td className={cn('px-3 py-2.5 align-middle', className)}>{children}</td>
}

export function EmptyState({
  title,
  body,
}: {
  title: string
  body?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-dashed border-ink/15 bg-paper-warm px-5 py-10 text-center">
      <p className="font-sans text-[14px] font-semibold text-ink">{title}</p>
      {body && <p className="mx-auto mt-1.5 max-w-md text-[13px] text-ink/55">{body}</p>}
    </div>
  )
}

export function DefinitionRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ink/[.07] py-2 last:border-0">
      <span className="shrink-0 font-mono text-[9.5px] font-semibold tracking-[0.1em] text-ink/45">
        {label}
      </span>
      <span className="text-right text-[13px] text-ink">{children}</span>
    </div>
  )
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="mb-3 inline-block font-sans text-[12.5px] text-ink/50 hover:text-ink"
    >
      ‹ {children}
    </Link>
  )
}

/**
 * Every admin page carries this. The audit log is not a background detail —
 * the operator should know their name is on each action they take.
 */
export function AuditNote() {
  return (
    <p className="mt-5 border-t border-ink/[.07] pt-3 font-sans text-[11.5px] text-ink/40">
      Every action here writes to the audit log with your name and the reason you give.
    </p>
  )
}
