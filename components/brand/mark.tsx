import { cn } from '@/lib/utils'

/**
 * The AlongCo mark: an A with a smile under the apex, in the blue→rose gradient.
 * Inline SVG rather than the PNG so it stays sharp, inherits size, and costs no
 * request on the landing LCP path.
 */
export function Mark({
  className,
  style,
  title,
  tone,
}: {
  className?: string
  style?: React.CSSProperties
  title?: string
  /** Flatten to one colour where the gradient would fight the background. */
  tone?: 'light' | 'dark'
}) {
  const stroke =
    tone === 'light' ? '#FBFAF7' : tone === 'dark' ? '#16161A' : 'url(#ac-mark)'

  return (
    <svg
      viewBox="0 0 100 100"
      className={cn('block', className)}
      style={style}
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      {!tone && (
        <defs>
          <linearGradient
            id="ac-mark"
            x1="14"
            y1="86"
            x2="86"
            y2="86"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#2E63E8" />
            <stop offset="0.5" stopColor="#8A6BEF" />
            <stop offset="1" stopColor="#F76D8A" />
          </linearGradient>
        </defs>
      )}
      <g
        fill="none"
        stroke={stroke}
        strokeWidth="7.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 83 L50 17 L79 83" />
        <path d="M35 60 Q50 75 65 60" />
      </g>
    </svg>
  )
}

/** Mark + wordmark, the header lockup from the design canvas. */
export function Wordmark({
  className,
  tone = 'ink',
  size = 26,
}: {
  className?: string
  tone?: 'ink' | 'paper'
  size?: number
}) {
  return (
    <span className={cn('flex items-center gap-[9px]', className)}>
      <Mark className="shrink-0" style={{ width: size, height: size }} title="AlongCo" />
      <span
        className={cn(
          'font-sans font-semibold tracking-[0.18em]',
          tone === 'paper' ? 'text-white' : 'text-ink',
        )}
        style={{ fontSize: size * 0.48 }}
      >
        ALONG CO
      </span>
    </span>
  )
}

/** The 3px blue→violet→rose rule that tops every screen in the canvas. */
export function GradientRule({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'h-[3px] w-full bg-[linear-gradient(90deg,#2E63E8,#8A6BEF_45%,#F76D8A)]',
        className,
      )}
    />
  )
}
