import Link from 'next/link'
import { requireAdmin } from '@/lib/admin/auth'
import { listConfirmationQueue, type ConfirmationRow } from '@/lib/admin/queries'
import { getSettings, type Settings } from '@/lib/settings'
import { SUPPORT_PHONE } from '@/lib/contact'
import {
  companionConfirmation,
  customerConfirmation,
  durationLabel,
  waMeLink,
  TEMPLATE_VERSION,
} from '@/lib/whatsapp/message-templates'
import { formatDateLong, formatSlotLabel } from '@/lib/time/zone'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, Money, PageHeader, Pill, Ref } from '../_components/ui'
import { CopyButton } from './_components/copy-button'
import { markConfirmationSent } from './actions'

export const metadata = {
  title: 'Confirmation queue · AlongCo Admin',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function ConfirmationsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  await requireAdmin()
  const sp = await searchParams
  const showSent = sp.view === 'sent'

  const settings = await getSettings()
  const rows = await listConfirmationQueue({ includeSent: showSent })
  const unsent = rows.filter((r) => !r.confirmationSentAt)
  const sent = rows.filter((r) => r.confirmationSentAt)
  const visible = showSent ? sent : unsent

  return (
    <>
      <PageHeader
        eyebrow="THE SCREEN THAT RUNS THE BUSINESS"
        title="Confirmation queue"
        meta="Newly paid bookings. Copy the message, send it from WhatsApp Business, then mark it sent."
      />

      <div className="mb-4 flex gap-1.5">
        <TabLink href="/admin/confirmations" active={!showSent}>
          UNSENT · {unsent.length}
        </TabLink>
        <TabLink href="/admin/confirmations?view=sent" active={showSent}>
          SENT
        </TabLink>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={showSent ? 'Nothing sent yet' : 'The queue is clear'}
          body={
            showSent
              ? 'Confirmations you have dispatched will be listed here with who sent them.'
              : 'Every confirmed booking has had its WhatsApp message dispatched.'
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {visible.map((row) => (
            <QueueCard
              key={row.bookingId}
              row={row}
              settings={settings}
              slaMinutes={settings.confirmationSlaMinutes}
            />
          ))}
        </div>
      )}
    </>
  )
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? 'rounded-md bg-ink px-2.5 py-1.5 font-mono text-[10px] font-semibold tracking-[0.08em] text-white'
          : 'rounded-md px-2.5 py-1.5 font-mono text-[10px] font-semibold tracking-[0.08em] text-ink/50 hover:bg-paper-sunk'
      }
    >
      {children}
    </Link>
  )
}

function QueueCard({
  row,
  settings,
  slaMinutes,
}: {
  row: ConfirmationRow
  settings: Settings
  slaMinutes: number
}) {
  const tz = settings.timezone
  const starts = new Date(row.startsAt)
  const ends = new Date(row.endsAt)
  const minutes = Math.round((ends.getTime() - starts.getTime()) / 60000)
  const overdue = !row.confirmationSentAt && row.minutesWaiting > slaMinutes

  const facts = {
    reference: row.reference,
    customerFirstName: row.customerFirstName,
    companionDisplayName: row.companionName,
    dayLabel: formatDateLong(starts, tz),
    startLabel: formatSlotLabel(starts, tz),
    endLabel: formatSlotLabel(ends, tz),
    areaName: row.areaName,
    durationLabel: durationLabel(minutes),
    customerNotes: row.customerNotes,
    supportPhone: SUPPORT_PHONE,
  }

  const customerMessage = customerConfirmation(facts)
  const companionMessage = companionConfirmation(facts)

  return (
    <Card tone={overdue ? 'danger' : 'default'}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-ink/[.07] pb-3">
        <div className="flex items-center gap-2.5">
          <Ref>{row.reference}</Ref>
          {overdue ? (
            <Pill tone="rose">OVERDUE · {row.minutesWaiting} MIN</Pill>
          ) : row.confirmationSentAt ? (
            <Pill tone="green">SENT</Pill>
          ) : (
            <Pill tone="amber">{row.minutesWaiting} MIN AGO</Pill>
          )}
        </div>
        <span className="font-mono text-[10px] tracking-[0.06em] text-ink/45">
          PAID · <Money paise={row.amountPaise} className="text-[11px]" />
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="font-mono text-[9.5px] font-semibold tracking-[0.1em] text-ink/45">
            CUSTOMER
          </p>
          <p className="mt-1 text-[13.5px] font-semibold text-ink">
            {row.customerFirstName}
          </p>
          {/* The one place a customer number is deliberately on screen — the
              admin needs it to open wa.me. It is never written to a log (§9). */}
          <p className="font-mono text-[12px] text-ink/60">{row.customerPhone}</p>
        </div>
        <div>
          <p className="font-mono text-[9.5px] font-semibold tracking-[0.1em] text-ink/45">
            BOOKING
          </p>
          <p className="mt-1 text-[13.5px] text-ink">
            {row.companionName} · {formatDateLong(starts, tz)},{' '}
            {formatSlotLabel(starts, tz)} · {row.areaName} · {durationLabel(minutes)}
          </p>
        </div>
      </div>

      {row.customerNotes?.trim() && (
        <div className="mt-3">
          <p className="font-mono text-[9.5px] font-semibold tracking-[0.1em] text-ink/45">
            CUSTOMER NOTE
          </p>
          <p className="mt-1 text-[13px] italic text-ink/75">
            &ldquo;{row.customerNotes.trim()}&rdquo;
          </p>
        </div>
      )}

      <div className="mt-4 rounded-lg border border-ink/10 bg-paper-sunk p-3">
        <p className="mb-2 font-mono text-[9.5px] font-semibold tracking-[0.1em] text-ink/45">
          MESSAGE TO SEND · TEMPLATE {TEMPLATE_VERSION.toUpperCase()} · CUSTOMER
        </p>
        <pre className="whitespace-pre-wrap font-sans text-[13px] leading-[1.55] text-ink/85">
          {customerMessage}
        </pre>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <CopyButton text={customerMessage} />
        <a
          href={waMeLink(row.customerPhone)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center rounded-lg border border-blue/25 bg-blue-tint px-3 font-sans text-[12.5px] font-semibold text-blue-dark hover:bg-blue-tint/70"
        >
          Open WhatsApp
        </a>
        <CopyButton text={companionMessage} label="Companion message" />

        {!row.confirmationSentAt && (
          <form action={markConfirmationSent} className="ml-auto">
            <input type="hidden" name="bookingId" value={row.bookingId} />
            <Button type="submit" variant="ink" size="sm">
              Mark sent
            </Button>
          </form>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-ink/[.07] pt-2.5">
        <Link
          href={`/admin/bookings/${row.bookingId}`}
          className="font-sans text-[12px] text-blue hover:text-ink"
        >
          Open booking →
        </Link>
        {row.confirmationSentAt && (
          <span className="font-mono text-[9.5px] tracking-[0.08em] text-ink/45">
            SENT {formatSlotLabel(new Date(row.confirmationSentAt), tz)}
          </span>
        )}
      </div>
    </Card>
  )
}
