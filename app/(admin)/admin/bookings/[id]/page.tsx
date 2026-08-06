import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin, hasRole } from '@/lib/admin/auth'
import { getAdminBooking, getRefundQuote } from '@/lib/admin/queries'
import { getSettings } from '@/lib/settings'
import { formatPaise } from '@/lib/booking/pricing'
import { durationLabel } from '@/lib/whatsapp/message-templates'
import { formatDateLong, formatSlotLabel } from '@/lib/time/zone'
import {
  AuditNote,
  BackLink,
  Card,
  Cell,
  DefinitionRow,
  Money,
  PageHeader,
  Pill,
  Ref,
  Row,
  SectionTitle,
  StatusPill,
  Table,
} from '../../_components/ui'
import { CancelPanel, type TriggerOption } from './_components/cancel-panel'
import { RetryRefundButton } from './_components/retry-refund'

export const metadata = {
  title: 'Booking · AlongCo Admin',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

/** Cancellation reasons, each carrying the tier the database will apply. */
const TRIGGERS: Omit<TriggerOption, 'amountPaise' | 'percent' | 'tierCode'>[] = [
  {
    value: 'admin_cancel',
    label: 'Cancelling on the customer’s behalf',
    description: 'Uses the time-based refund tiers, exactly as her own cancellation would.',
    requiresIncident: false,
    freesSlot: true,
  },
  {
    value: 'companion_cancel',
    label: 'The companion cancelled',
    description: 'Full refund regardless of notice, plus priority rebooking.',
    requiresIncident: false,
    freesSlot: true,
  },
  {
    value: 'companion_no_show',
    label: 'The companion did not show',
    description: 'Full refund. Second occurrence deactivates him.',
    requiresIncident: false,
    freesSlot: true,
  },
  {
    value: 'customer_no_show',
    label: 'The customer did not show',
    description: 'No refund. The hour is treated as consumed and is not resold.',
    requiresIncident: false,
    freesSlot: false,
  },
  {
    value: 'conduct_breach',
    label: 'Ended early for a conduct breach',
    description: 'No refund, per the terms she accepted. Requires an incident record.',
    requiresIncident: true,
    freesSlot: false,
  },
]

const CANCELLABLE = new Set(['pending_payment', 'confirmed', 'completed'])

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const admin = await requireAdmin()
  const { id } = await params

  const booking = await getAdminBooking(id)
  if (!booking) notFound()

  const settings = await getSettings()
  const tz = settings.timezone
  const starts = new Date(booking.startsAt)
  const ends = new Date(booking.endsAt)

  const canCancel = CANCELLABLE.has(booking.status) && hasRole(admin, 'ops')

  // Every refund figure comes from the database, one quote per reason, before
  // anything is shown on screen (PRD §6.9 — stated before she confirms).
  const options: TriggerOption[] = canCancel
    ? (
        await Promise.all(
          TRIGGERS.map(async (t) => {
            const quoteTrigger = t.value === 'admin_cancel' ? 'customer_cancel' : t.value
            const q = await getRefundQuote(booking.id, quoteTrigger)
            return q
              ? { ...t, amountPaise: q.amountPaise, percent: q.percent, tierCode: q.tierCode }
              : null
          }),
        )
      ).filter((o): o is TriggerOption => o !== null)
    : []

  // An unpaid hold has nothing to send back, whatever the tier says.
  const paid = booking.payment?.status !== undefined
  const displayOptions = options.map((o) => ({
    ...o,
    amountPaise: paid ? o.amountPaise : 0,
  }))
  const formatted = Object.fromEntries(
    displayOptions.map((o) => [o.value, formatPaise(o.amountPaise)]),
  )

  const hoursOut = (starts.getTime() - Date.now()) / 3_600_000
  const startsInLabel =
    hoursOut < 0
      ? 'the past'
      : `${Math.floor(hoursOut)}h ${Math.round((hoursOut % 1) * 60)}m`

  const owedRefund = booking.refunds.find(
    (r) => r.status === 'created' || r.status === 'failed',
  )

  return (
    <>
      <BackLink href="/admin/bookings">Bookings</BackLink>

      <PageHeader
        eyebrow={booking.reference}
        title={`${booking.companionName} · ${booking.customerName.split(/\s+/)[0]}`}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={booking.status} />
            {booking.status === 'confirmed' && !booking.confirmationSentAt && (
              <Pill tone="amber">CONFIRMATION UNSENT</Pill>
            )}
            {booking.incidents.length > 0 && (
              <Pill tone="rose">
                {booking.incidents.length} INCIDENT
                {booking.incidents.length === 1 ? '' : 'S'}
              </Pill>
            )}
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle>THE BOOKING</SectionTitle>
            <DefinitionRow label="CUSTOMER">
              {booking.customerName}
              <br />
              <span className="font-mono text-[12px] text-ink/55">
                {booking.customerPhone}
              </span>
            </DefinitionRow>
            <DefinitionRow label="COMPANION">
              {/* Pseudonym only. His real name is never joined into this query. */}
              {booking.companionName}
            </DefinitionRow>
            <DefinitionRow label="WHEN">
              {formatDateLong(starts, tz)}
              <br />
              <span className="font-mono text-[12px] text-ink/70">
                {formatSlotLabel(starts, tz)} – {formatSlotLabel(ends, tz)} ·{' '}
                {durationLabel(booking.durationMinutes)}
              </span>
            </DefinitionRow>
            <DefinitionRow label="AREA">{booking.areaName}</DefinitionRow>
            <DefinitionRow label="AMOUNT">
              <Money paise={booking.amountPaise} />
              {booking.discountPercent > 0 && (
                <span className="ml-1.5 font-mono text-[10px] text-rose-deep">
                  −{booking.discountPercent}%
                </span>
              )}
            </DefinitionRow>
            <DefinitionRow label="TERMS ACCEPTED">
              <span className="font-mono text-[12px]">
                v{booking.termsVersion} ·{' '}
                {formatDateLong(new Date(booking.termsAcceptedAt), tz)}
              </span>
            </DefinitionRow>
            {booking.customerNotes?.trim() && (
              <DefinitionRow label="HER NOTE">
                <span className="italic text-ink/75">
                  &ldquo;{booking.customerNotes.trim()}&rdquo;
                </span>
              </DefinitionRow>
            )}
            {booking.cancelledAt && (
              <DefinitionRow label="CANCELLED">
                {formatDateLong(new Date(booking.cancelledAt), tz)}
                {booking.refundTierApplied && (
                  <>
                    <br />
                    <span className="font-mono text-[11px] text-ink/55">
                      tier {booking.refundTierApplied}
                    </span>
                  </>
                )}
                {booking.cancellationReason && (
                  <>
                    <br />
                    <span className="text-[12px] text-ink/60">
                      {booking.cancellationReason}
                    </span>
                  </>
                )}
              </DefinitionRow>
            )}
          </Card>

          <Card>
            <SectionTitle>PAYMENT</SectionTitle>
            {booking.payment ? (
              <>
                <DefinitionRow label="STATUS">
                  <Pill
                    tone={
                      booking.payment.status === 'captured'
                        ? 'green'
                        : booking.payment.status === 'failed'
                          ? 'rose'
                          : 'neutral'
                    }
                  >
                    {booking.payment.status.toUpperCase().replace(/_/g, ' ')}
                  </Pill>
                </DefinitionRow>
                <DefinitionRow label="CAPTURED">
                  <Money paise={booking.payment.amountPaise} />
                  {booking.payment.method && (
                    <span className="ml-1.5 font-mono text-[10px] uppercase text-ink/50">
                      {booking.payment.method}
                    </span>
                  )}
                </DefinitionRow>
                <DefinitionRow label="GATEWAY ORDER">
                  <span className="font-mono text-[11px] text-ink/60">
                    {booking.payment.providerOrderId}
                  </span>
                </DefinitionRow>
              </>
            ) : (
              <p className="text-[13px] text-ink/55">
                No captured payment. Nothing can be refunded against this booking.
              </p>
            )}

            {booking.refunds.length > 0 && (
              <div className="mt-3 border-t border-ink/[.07] pt-3">
                <SectionTitle>REFUNDS</SectionTitle>
                {booking.refunds.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between border-b border-ink/[.07] py-2 last:border-0"
                  >
                    <span className="flex items-center gap-2">
                      <Money paise={r.amountPaise} />
                      <Pill
                        tone={
                          r.status === 'success'
                            ? 'green'
                            : r.status === 'failed'
                              ? 'rose'
                              : 'amber'
                        }
                      >
                        {r.status.toUpperCase()}
                      </Pill>
                    </span>
                    <span className="font-mono text-[10px] text-ink/45">
                      {r.tierApplied}
                    </span>
                  </div>
                ))}
                {owedRefund && hasRole(admin, 'ops') && (
                  <div className="mt-2.5">
                    <p className="mb-2 text-[12.5px] leading-[1.5] text-rose-deep">
                      This refund is recorded as owed but has not settled with the
                      gateway. Retrying is safe — the same refund reference is reused as
                      the idempotency key, so a second refund cannot be issued.
                    </p>
                    <RetryRefundButton refundId={owedRefund.id} />
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          {canCancel && displayOptions.length > 0 ? (
            <CancelPanel
              bookingId={booking.id}
              options={displayOptions}
              formatted={formatted}
              amountPaidLabel={formatPaise(booking.payment?.amountPaise ?? 0)}
              startsInLabel={startsInLabel}
            />
          ) : (
            <Card>
              <SectionTitle>CANCELLATION</SectionTitle>
              <p className="text-[13px] leading-[1.5] text-ink/60">
                {CANCELLABLE.has(booking.status)
                  ? 'Cancelling a booking needs the ops role.'
                  : 'This booking has already reached a final state. Nothing further can be cancelled or refunded here.'}
              </p>
            </Card>
          )}

          <Card>
            <div className="flex items-center justify-between">
              <SectionTitle>INCIDENTS</SectionTitle>
              <Link
                href={`/admin/incidents/new?booking=${booking.id}`}
                className="mb-3 font-sans text-[12px] font-semibold text-blue hover:text-ink"
              >
                Record one →
              </Link>
            </div>
            {booking.incidents.length === 0 ? (
              <p className="text-[13px] text-ink/55">Nothing recorded against this booking.</p>
            ) : (
              booking.incidents.map((i) => (
                <Link
                  key={i.id}
                  href={`/admin/incidents#${i.id}`}
                  className="flex items-center justify-between border-b border-ink/[.07] py-2 text-[13px] last:border-0 hover:text-blue"
                >
                  <span className="capitalize">{i.type.replace(/_/g, ' ')}</span>
                  <Pill tone={i.status === 'resolved' ? 'green' : 'amber'}>
                    {i.status.toUpperCase()}
                  </Pill>
                </Link>
              ))
            )}
          </Card>

          <Card>
            <SectionTitle>HISTORY</SectionTitle>
            {booking.events.length === 0 ? (
              <p className="text-[13px] text-ink/55">No status changes recorded.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {booking.events.map((e) => (
                  <li key={e.id} className="border-b border-ink/[.07] pb-2 last:border-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[11px] font-semibold text-ink">
                        {(e.fromStatus ?? 'new').replace(/_/g, ' ')} →{' '}
                        {e.toStatus.replace(/_/g, ' ')}
                      </span>
                      <span className="whitespace-nowrap font-mono text-[9.5px] uppercase text-ink/40">
                        {e.actorType}
                      </span>
                    </div>
                    {e.reason && (
                      <p className="mt-0.5 text-[12px] text-ink/60">{e.reason}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>

      <AuditNote />
    </>
  )
}
