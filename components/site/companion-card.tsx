import Link from 'next/link'
import Image from 'next/image'
import { formatPaise } from '@/lib/booking/pricing'
import type { CompanionCard as Card } from '@/lib/companions'
import { cn } from '@/lib/utils'

/**
 * Browse card. Note what is not here: no "verified", "screened" or
 * "background-checked" anywhere (CLAUDE.md §3.7). "Verified review" is allowed
 * and means only that the reviewer completed a booking.
 */
export function CompanionCard({
  companion,
  status,
}: {
  companion: Card
  /** e.g. 'FREE 4PM' or 'NEXT: FRI'. Facts only — no scarcity copy. */
  status?: { label: string; tone: 'free' | 'later' }
}) {
  const paused = !companion.isAccepting

  return (
    <Link
      href={`/companions/${companion.slug}`}
      className={cn(
        'flex gap-[13px] rounded-[10px] border border-ink/10 bg-white p-[13px] shadow-[0_1px_3px_rgba(22,22,26,.05)]',
        paused && 'opacity-[.72]',
      )}
    >
      <Portrait
        url={companion.photoUrl}
        name={companion.displayName}
        muted={paused}
        className="h-[108px] w-[84px]"
      />

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="truncate font-sans text-[16px] font-semibold text-ink">
            {companion.displayName}
          </span>
          <span
            className={cn(
              'shrink-0 font-mono text-[13px] font-semibold',
              paused ? 'text-ink/50' : 'text-ink',
            )}
          >
            {formatPaise(companion.hourlyRatePaise)}
            <span className="font-mono text-[9.5px] font-medium text-ink/45">/HR</span>
          </span>
        </div>

        <div className="mb-[7px] font-mono text-[10.5px] font-medium uppercase text-ink/50">
          {companion.areas.join(' · ') || 'AREAS TO BE CONFIRMED'}
        </div>

        {paused ? (
          <span className="inline-block rounded-[3px] bg-amber-tint px-[7px] py-[5px] font-mono text-[9.5px] font-semibold text-amber">
            PAUSED — NOT TAKING BOOKINGS THIS WEEK
          </span>
        ) : (
          <>
            {companion.bio && (
              <p className="mb-[9px] line-clamp-2 font-sans text-[12.5px] leading-[1.45] text-ink/60">
                {companion.bio}
              </p>
            )}
            <div className="flex items-center gap-2">
              {companion.reviewCount > 0 ? (
                <>
                  <span className="font-mono text-[10.5px] font-semibold text-ink">
                    {companion.averageRating?.toFixed(1)}
                  </span>
                  <span className="font-sans text-[10.5px] text-ink/50">
                    · {companion.reviewCount} verified review
                    {companion.reviewCount === 1 ? '' : 's'}
                  </span>
                </>
              ) : (
                <span className="font-sans text-[10.5px] text-ink/50">
                  No reviews yet
                </span>
              )}
              {status && (
                <span
                  className={cn(
                    'ml-auto shrink-0 rounded-[3px] px-1.5 py-1 font-mono text-[9.5px] font-semibold',
                    status.tone === 'free'
                      ? 'bg-green-tint text-green'
                      : 'bg-[#F1EFEA] text-ink/45',
                  )}
                >
                  {status.label}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </Link>
  )
}

/**
 * Portrait with a placeholder that is clearly a placeholder. The design canvas
 * marks the crop as not-yet-real, and an obvious stand-in beats a stock photo
 * on a screen whose whole job is being trusted.
 */
export function Portrait({
  url,
  name,
  className,
  muted,
  priority,
  sizes = '84px',
}: {
  url: string | null
  name: string
  className?: string
  muted?: boolean
  priority?: boolean
  sizes?: string
}) {
  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden rounded-[7px] bg-[#dfe6f8]',
        muted && 'grayscale',
        className,
      )}
    >
      {url ? (
        <Image
          src={url}
          alt={name}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
        />
      ) : (
        <>
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                'repeating-linear-gradient(128deg, rgba(46,99,232,.13) 0 8px, rgba(46,99,232,0) 8px 16px)',
            }}
          />
          <span className="absolute inset-x-0 bottom-0 bg-paper/85 px-[5px] py-1 font-mono text-[6.5px] font-medium tracking-[0.06em] text-ink/55">
            PHOTOGRAPH TO COME
          </span>
        </>
      )}
    </div>
  )
}
