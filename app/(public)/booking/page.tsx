import Link from 'next/link'
import { TicketLookup } from '../_components/ticket-lookup'
import { Button } from '@/components/ui/button'

export const metadata = {
  title: 'Check Your Booking | AlongCo',
  description: 'Enter your booking reference to view your booking details.',
}

export default function BookingPage() {
  return (
    <div className="min-h-screen bg-paper">
      {/* Header */}
      <div className="border-b border-ink/10 bg-white">
        <div className="mx-auto max-w-[600px] px-5 py-4 flex items-center justify-between">
          <h1 className="font-serif text-[24px] font-light text-ink">Check your booking</h1>
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-ink/60 hover:text-ink">
              ← Home
            </Button>
          </Link>
        </div>
      </div>

      {/* Main content */}
      <div className="mx-auto max-w-[600px] px-5 py-12">
        <div className="space-y-8">
          {/* Description */}
          <div>
            <p className="font-sans text-[15px] leading-[1.6] text-ink/70 max-w-[54ch]">
              Enter your booking reference to view your booking details. Your reference is on
              your confirmation email or WhatsApp message.
            </p>
          </div>

          {/* Lookup form */}
          <div className="rounded-lg border border-ink/10 bg-white p-6">
            <TicketLookup />
          </div>

          {/* Help text */}
          <div className="rounded-lg bg-blue-tint border border-blue/20 p-4">
            <p className="font-sans text-[13px] leading-[1.6] text-blue-dark">
              Can't find your reference?{' '}
              <Link href="/" className="font-semibold underline">
                Contact us for support
              </Link>
              .
            </p>
          </div>

          {/* CTA to browse */}
          <div className="border-t border-ink/10 pt-8">
            <p className="font-sans text-[14px] text-ink/60 mb-4">Or start a new booking:</p>
            <Button asChild size="lg" sheen className="w-full">
              <Link href="/companions">See who is free this week</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
