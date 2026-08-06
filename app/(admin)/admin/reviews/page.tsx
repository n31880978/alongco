import Link from 'next/link'
import { requireAdmin } from '@/lib/admin/auth'
import { listAdminReviews } from '@/lib/admin/queries'
import { getSettings } from '@/lib/settings'
import { formatDateShort } from '@/lib/time/zone'
import { AuditNote, Card, EmptyState, PageHeader, Pill, Ref, SectionTitle } from '../_components/ui'
import { ModerationControls } from './_components/moderation-controls'

export const metadata = {
  title: 'Reviews · AlongCo Admin',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function ReviewsPage() {
  await requireAdmin()
  const [reviews, settings] = await Promise.all([listAdminReviews(), getSettings()])

  const pending = reviews.filter((r) => !r.moderatedAt)
  const published = reviews.filter((r) => r.isPublished)
  const rejected = reviews.filter((r) => r.moderatedAt && !r.isPublished)

  return (
    <>
      <PageHeader
        eyebrow="MODERATION"
        title="Reviews"
        meta={`${pending.length} awaiting moderation · ${published.length} published`}
      />

      <p className="mb-4 rounded-xl border border-ink/10 bg-paper-warm px-4 py-3 text-[12.5px] leading-[1.5] text-ink/60">
        Nothing publishes without moderation. A &ldquo;verified review&rdquo; means only
        that the reviewer completed a booking — it is never a claim about the companion.
      </p>

      {reviews.length === 0 ? (
        <EmptyState
          title="No reviews yet"
          body="A review can only be written by the customer who made a booking, after it completed."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {pending.length > 0 && (
            <section>
              <SectionTitle>AWAITING MODERATION</SectionTitle>
              <div className="flex flex-col gap-3">
                {pending.map((r) => (
                  <ReviewCard key={r.id} review={r} tz={settings.timezone} editable />
                ))}
              </div>
            </section>
          )}

          {published.length > 0 && (
            <section>
              <SectionTitle>PUBLISHED</SectionTitle>
              <div className="flex flex-col gap-3">
                {published.map((r) => (
                  <ReviewCard key={r.id} review={r} tz={settings.timezone} editable />
                ))}
              </div>
            </section>
          )}

          {rejected.length > 0 && (
            <section>
              <SectionTitle>REJECTED</SectionTitle>
              <div className="flex flex-col gap-3">
                {rejected.map((r) => (
                  <ReviewCard key={r.id} review={r} tz={settings.timezone} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <AuditNote />
    </>
  )
}

function ReviewCard({
  review: r,
  tz,
  editable,
}: {
  review: Awaited<ReturnType<typeof listAdminReviews>>[number]
  tz: string
  editable?: boolean
}) {
  return (
    <Card tone={r.hasOpenIncident ? 'warning' : 'default'}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-sans text-[13.5px] font-semibold text-ink">
            {r.customerFirstName} on {r.companionName}
          </span>
          <span className="font-mono text-[12.5px] font-semibold text-ink">
            {r.rating.toFixed(1)}
          </span>
          {r.isPublished && <Pill tone="green">PUBLISHED</Pill>}
          {r.hasOpenIncident && <Pill tone="rose">LINKED TO OPEN INCIDENT</Pill>}
        </div>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink/45">
          <Ref>{r.bookingReference}</Ref> · {r.bookingStatus?.replace(/_/g, ' ')} ·{' '}
          {formatDateShort(new Date(r.createdAt), tz)}
        </span>
      </div>

      {r.body?.trim() ? (
        <p className="text-[13px] leading-[1.55] text-ink/80">{r.body}</p>
      ) : (
        <p className="text-[13px] italic text-ink/45">A rating with no written review.</p>
      )}

      {r.moderationNote && (
        <p className="mt-2 text-[12px] text-ink/55">
          <span className="font-mono text-[9.5px] font-semibold tracking-[0.1em] text-ink/45">
            NOTE
          </span>{' '}
          {r.moderationNote}
        </p>
      )}

      {editable ? (
        <ModerationControls
          id={r.id}
          blocked={r.hasOpenIncident}
          note={r.moderationNote}
        />
      ) : null}
    </Card>
  )
}
