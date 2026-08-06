import Link from 'next/link'
import { notFound } from 'next/navigation'
import { hasRole, requireAdmin } from '@/lib/admin/auth'
import { getAdminCompanion, getCompanionIdentity, listAdminAreas } from '@/lib/admin/queries'
import { photoUrl } from '@/lib/companions'
import { getSettings } from '@/lib/settings'
import { formatDateShort, formatSlotLabel } from '@/lib/time/zone'
import { Button } from '@/components/ui/button'
import {
  AuditNote,
  BackLink,
  Card,
  PageHeader,
  Pill,
  SectionTitle,
} from '../../_components/ui'
import { CompanionForm } from '../_components/companion-form'
import { AvailabilityEditor, BlackoutEditor } from '../_components/schedule-editor'
import { IdentityPanel } from '../_components/identity-panel'
import { PhotoUpload } from '../_components/photo-upload'
import { toggleCompanion } from '../actions'

export const metadata = {
  title: 'Companion · AlongCo Admin',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function CompanionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const admin = await requireAdmin()
  const { id } = await params

  const companion = await getAdminCompanion(id)
  if (!companion) notFound()

  const [areas, settings] = await Promise.all([listAdminAreas(), getSettings()])
  const tz = settings.timezone

  // Real identity is fetched only for an owner. A non-owner's page never holds
  // the data at all, rather than holding it and hiding it (CLAUDE.md §3.6).
  const isOwner = hasRole(admin, 'owner')
  const identity = isOwner ? await getCompanionIdentity(companion.id) : null

  const canList = companion.hasIdentity
  const blackoutLabels = Object.fromEntries(
    companion.blackouts.map((b) => [
      b.id,
      `${formatDateShort(new Date(b.startsAt), tz)} ${formatSlotLabel(new Date(b.startsAt), tz)} – ${formatDateShort(new Date(b.endsAt), tz)} ${formatSlotLabel(new Date(b.endsAt), tz)}`,
    ]),
  )

  return (
    <>
      <BackLink href="/admin/companions">Companions</BackLink>

      <PageHeader
        eyebrow={`/${companion.slug}`}
        title={companion.displayName}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            {!companion.isActive ? (
              <Pill tone="neutral">UNLISTED</Pill>
            ) : companion.isAccepting ? (
              <Pill tone="green">ACTIVE</Pill>
            ) : (
              <Pill tone="amber">PAUSED</Pill>
            )}
            <span className="text-[12.5px] text-ink/55">
              {companion.upcomingCount} upcoming booking
              {companion.upcomingCount === 1 ? '' : 's'}
            </span>
            {companion.isActive && (
              <Link
                href={`/c/${companion.slug}`}
                className="text-[12.5px] text-blue hover:text-ink"
              >
                View profile →
              </Link>
            )}
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle>LISTING STATE</SectionTitle>
            <div className="flex flex-wrap gap-2">
              <form action={toggleCompanion}>
                <input type="hidden" name="id" value={companion.id} />
                <input type="hidden" name="field" value="is_active" />
                <input
                  type="hidden"
                  name="value"
                  value={companion.isActive ? 'false' : 'true'}
                />
                <Button
                  type="submit"
                  variant={companion.isActive ? 'outline' : 'ink'}
                  size="sm"
                  disabled={!companion.isActive && !canList}
                >
                  {companion.isActive ? 'Unlist him' : 'List him publicly'}
                </Button>
              </form>

              <form action={toggleCompanion}>
                <input type="hidden" name="id" value={companion.id} />
                <input type="hidden" name="field" value="is_accepting" />
                <input
                  type="hidden"
                  name="value"
                  value={companion.isAccepting ? 'false' : 'true'}
                />
                <Button type="submit" variant="outline" size="sm">
                  {companion.isAccepting ? 'Pause bookings' : 'Resume bookings'}
                </Button>
              </form>
            </div>

            <p className="mt-2.5 text-[12px] leading-[1.5] text-ink/55">
              {!canList ? (
                <span className="text-amber">
                  He cannot be listed until an identity record with a signed conduct
                  agreement exists.
                </span>
              ) : companion.isActive ? (
                'Listed. Pausing keeps his profile readable but stops new bookings; unlisting 404s the profile entirely.'
              ) : (
                'Unlisted. His profile returns 404 and he does not appear in browse.'
              )}
            </p>
          </Card>

          <Card>
            <SectionTitle>PHOTOGRAPH</SectionTitle>
            <PhotoUpload
              companionId={companion.id}
              photoUrl={photoUrl(companion.photoPath)}
            />
          </Card>

          <Card>
            <SectionTitle>DETAILS</SectionTitle>
            <CompanionForm areas={areas} companion={companion} />
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle>WEEKLY HOURS</SectionTitle>
            <AvailabilityEditor companionId={companion.id} rules={companion.rules} />
            <p className="mt-2.5 text-[12px] leading-[1.5] text-ink/55">
              Slots are computed from these, minus blackouts, minus existing bookings and
              their {settings.bufferMinutes}-minute buffer, clamped to{' '}
              {settings.serviceHours.start}–{settings.serviceHours.end}.
            </p>
          </Card>

          <Card>
            <SectionTitle>BLACKOUTS</SectionTitle>
            <BlackoutEditor
              companionId={companion.id}
              blackouts={companion.blackouts}
              formatRange={blackoutLabels}
            />
          </Card>

          {isOwner ? (
            <Card tone="danger">
              <SectionTitle>INTERNAL IDENTITY — OWNER ONLY</SectionTitle>
              <IdentityPanel
                companionId={companion.id}
                identity={
                  identity as React.ComponentProps<typeof IdentityPanel>['identity']
                }
              />
            </Card>
          ) : (
            <Card>
              <SectionTitle>INTERNAL IDENTITY</SectionTitle>
              <p className="text-[13px] leading-[1.5] text-ink/60">
                Legal name, phone, ID document and vetting notes are visible to the owner
                role only.{' '}
                {companion.hasIdentity
                  ? 'A record exists for this companion.'
                  : 'No record exists yet, so he cannot be listed.'}
              </p>
            </Card>
          )}
        </div>
      </div>

      <AuditNote />
    </>
  )
}
