'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'

export function TicketLookup() {
  const [reference, setReference] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const ref = reference.trim().toUpperCase()
      if (!ref) {
        setError('Enter your booking reference')
        setIsLoading(false)
        return
      }

      // Navigate to check booking page with reference as query param
      router.push(`/check-booking?reference=${ref}`)
    } catch (err) {
      setError('Something went wrong. Please try again.')
      setIsLoading(false)
    }
  }

  return (
    <div className="rounded-[9px] border border-blue/20 bg-blue-tint p-6">
      <h3 className="mb-2 font-sans text-[16px] font-semibold text-ink">
        Check your booking
      </h3>
      <p className="mb-4 font-sans text-[14px] text-ink/60">
        Paste your ticket reference to see booking details without signing in.
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <Input
          type="text"
          placeholder="e.g. AC-7F3K2M"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          disabled={isLoading}
          className="font-mono text-[14px] uppercase"
          maxLength={20}
        />
        {error && <p className="text-[13px] text-rose">{error}</p>}
        <Button
          type="submit"
          disabled={isLoading || !reference.trim()}
          className="w-full"
        >
          {isLoading ? 'Looking up...' : 'Check booking'}
        </Button>
      </form>
    </div>
  )
}
