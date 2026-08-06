import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg font-sans font-semibold transition-colors disabled:pointer-events-none disabled:opacity-60',
  {
    variants: {
      variant: {
        // The gradient primary from the design canvas, with the sheen sweep.
        primary:
          'relative overflow-hidden text-white bg-[linear-gradient(90deg,#2E63E8,#F76D8A)] shadow-[0_8px_20px_rgba(46,99,232,.24)]',
        ink: 'bg-ink text-white hover:bg-ink-deep',
        outline:
          'border border-ink/15 bg-white text-ink hover:bg-paper-warm',
        tint: 'border border-blue/25 bg-blue-tint text-blue-dark hover:bg-blue-tint/70',
        ghost: 'text-ink hover:bg-paper-sunk',
        danger: 'bg-rose-deep text-white hover:bg-rose-deep/90',
      },
      size: {
        lg: 'h-[52px] px-5 text-[15px]',
        md: 'h-[46px] px-4 text-[13.5px]',
        sm: 'h-9 px-3 text-[12.5px]',
      },
    },
    defaultVariants: { variant: 'primary', size: 'lg' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /** Adds the sweeping highlight. Primary calls to action only. */
  sheen?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, sheen, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      >
        <>
          {sheen && variant !== 'outline' ? (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 w-[38%] animate-sheen bg-[linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.34),rgba(255,255,255,0))]"
            />
          ) : null}
          <span className="relative z-10 flex items-center gap-2">{children}</span>
        </>
      </Comp>
    )
  },
)
Button.displayName = 'Button'

export { buttonVariants }
