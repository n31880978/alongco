import { cn } from '@/lib/utils'

/**
 * The drifting aurora field behind the hero and the ticket, plus the grain
 * overlay. Every animation here is gated by the reduced-motion rule in
 * globals.css (CLAUDE.md §5) — the blobs still render, they simply stop moving.
 */
export function Aurora({
  variant = 'light',
  className,
}: {
  variant?: 'light' | 'dark'
  className?: string
}) {
  const dark = variant === 'dark'

  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      <div
        className="absolute -left-[120px] -top-[130px] h-[340px] w-[340px] rounded-full blur-[26px] animate-drift"
        style={{
          background: `radial-gradient(circle, rgba(46,99,232,${dark ? 0.4 : 0.34}), rgba(46,99,232,0) 68%)`,
        }}
      />
      <div
        className={cn(
          'absolute h-[300px] w-[300px] rounded-full blur-[26px] animate-drift2',
          dark ? '-right-[120px] bottom-[60px]' : '-right-[110px] -top-[60px]',
        )}
        style={{
          background: `radial-gradient(circle, rgba(247,109,138,${dark ? 0.34 : 0.36}), rgba(247,109,138,0) 68%)`,
        }}
      />
      {!dark && (
        <div
          className="absolute -bottom-[150px] left-10 h-[260px] w-[260px] rounded-full blur-[30px] animate-drift3"
          style={{
            background:
              'radial-gradient(circle, rgba(138,107,239,.26), rgba(138,107,239,0) 68%)',
          }}
        />
      )}
      <Grain opacity={dark ? 0.45 : 0.5} blend={!dark} />
    </div>
  )
}

export function Grain({
  opacity = 0.5,
  blend = true,
  className,
}: {
  opacity?: number
  blend?: boolean
  className?: string
}) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0', className)}
      style={{
        opacity,
        mixBlendMode: blend ? 'multiply' : undefined,
        backgroundSize: '180px 180px',
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='.38'/%3E%3C/svg%3E")`,
      }}
    />
  )
}
