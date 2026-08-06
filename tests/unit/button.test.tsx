import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button } from '@/components/ui/button'

/**
 * Regression guard for a bug that produced no error at all.
 *
 * `Button asChild` wrapped its children in a fragment, which made the FRAGMENT
 * the single child Radix Slot merges props onto. React silently drops props on
 * a Fragment, so every class name vanished and the primary call to action on
 * the companion profile — the only route to booking anyone — rendered as plain
 * unstyled link text. Nothing threw, nothing logged, and the page looked
 * broken rather than errored.
 */

describe('Button asChild', () => {
  it('puts the button classes on the child element, not a fragment', () => {
    const html = renderToStaticMarkup(
      <Button asChild size="lg">
        <a href="/book/arjun">Check his availability</a>
      </Button>,
    )

    expect(html).toContain('href="/book/arjun"')
    expect(html).toContain('Check his availability')
    // The visual identity of a primary action: the gradient and the pill shape.
    expect(html).toMatch(/class="[^"]*rounded-lg/)
    expect(html).toMatch(/class="[^"]*inline-flex/)
  })

  it('renders a single anchor, not an anchor nested in a styled wrapper', () => {
    const html = renderToStaticMarkup(
      <Button asChild>
        <a href="/x">Go</a>
      </Button>,
    )
    // Slot merges onto the child; it must not emit a <button> as well.
    expect(html).not.toContain('<button')
    expect(html.match(/<a /g)).toHaveLength(1)
  })

  it('keeps the sheen alongside the label when asChild', () => {
    const html = renderToStaticMarkup(
      <Button asChild sheen>
        <a href="/x">Pay ₹499 and book</a>
      </Button>,
    )
    expect(html).toContain('animate-sheen')
    expect(html).toContain('Pay ₹499 and book')
  })

  it('omits the sheen on outline, where a white sweep would be invisible', () => {
    const html = renderToStaticMarkup(
      <Button asChild sheen variant="outline">
        <a href="/x">Secondary</a>
      </Button>,
    )
    expect(html).not.toContain('animate-sheen')
  })

  it('still renders a real button when asChild is not used', () => {
    const html = renderToStaticMarkup(<Button size="md">Mark sent</Button>)
    expect(html).toContain('<button')
    expect(html).toMatch(/class="[^"]*inline-flex/)
    expect(html).toContain('Mark sent')
  })

  it('forwards disabled, so an inert pay button is genuinely inert', () => {
    const html = renderToStaticMarkup(<Button disabled>Pay</Button>)
    expect(html).toContain('disabled')
  })
})
