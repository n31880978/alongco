'use client'

import { useRef } from 'react'
import Image from 'next/image'
import { Grain } from '@/components/brand/aurora'
import { Button } from '@/components/ui/button'

/**
 * The ticket, printed on warm stock rather than designed on screen: perforated
 * edges, a tear line with punched notches, scanline ink texture, a dot-matrix
 * reference, a barcode stub and a PAID stamp that lands late.
 *
 * It prints itself out of a slot on load in stepped frames. Every one of those
 * animations is gated by the reduced-motion rule in globals.css (CLAUDE.md §5,
 * PRD §6.7) — with reduced motion the ticket is simply there, fully formed.
 *
 * Nothing here is the companion's real name. The QR carries the reference, and
 * that is the identity handshake at the meeting (§3.6).
 */
export function Ticket({
  reference,
  qrDataUrl,
  issuedLabel,
  companionName,
  durationLabel,
  dateLabel,
  timeLabel,
  areaLabel,
  bookedByLabel,
  amountLabel,
  methodLabel,
  termsLabel,
  conductSummary,
  cancelled,
}: {
  reference: string
  qrDataUrl: string
  issuedLabel: string
  companionName: string
  durationLabel: string
  dateLabel: string
  timeLabel: string
  areaLabel: string
  bookedByLabel: string
  amountLabel: string
  methodLabel: string
  termsLabel: string
  conductSummary: string
  cancelled: boolean
}) {
  const stockRef = useRef<HTMLDivElement>(null)

  return (
    <>
      {/* The printer slot the ticket emerges from */}
      <div aria-hidden className="relative mx-5 h-[22px]">
        <div className="absolute inset-x-0 top-2.5 h-[9px] rounded-sm bg-[#05060a] shadow-[inset_0_2px_4px_rgba(0,0,0,.9)]" />
      </div>

      <div className="relative mx-5 mb-[22px] overflow-hidden">
        <div className="relative animate-print [animation-delay:.35s]">
          <Perforations />

          <div
            ref={stockRef}
            className="ac-stock relative -mt-1.5 overflow-hidden bg-[#FCFAF3] shadow-[0_14px_34px_rgba(0,0,0,.45)]"
          >
            <Grain opacity={0.35} />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'linear-gradient(90deg, rgba(22,22,26,.07), rgba(22,22,26,0) 9%, rgba(22,22,26,0) 91%, rgba(22,22,26,.07))',
              }}
            />
            <div className="relative z-[1] h-[5px] bg-[linear-gradient(90deg,#2E63E8,#8A6BEF_50%,#F76D8A)]" />

            {/* Reference + QR */}
            <div className="relative z-[1] flex items-start justify-between gap-2.5 px-4 pb-3 pt-3.5">
              <div>
                <div className="mb-[5px] font-mono text-[8.5px] font-semibold tracking-[0.16em] text-[#23231f]/50">
                  ALONGCO · BOOKING TICKET
                </div>
                <div
                  className="font-mono text-[22px] font-bold tracking-[0.06em] text-[#23231f]"
                  style={{ textShadow: '0 0 .6px rgba(35,35,31,.5)' }}
                >
                  {reference}
                </div>
                <div className="mt-[5px] font-mono text-[9px] font-medium tracking-[0.1em] text-[#23231f]/50">
                  ISSUED {issuedLabel}
                </div>
              </div>
              <Image
                src={qrDataUrl}
                alt={`QR code for booking ${reference}`}
                width={66}
                height={66}
                unoptimized
                className="block shrink-0 opacity-[.92]"
              />
            </div>

            <p className="relative z-[1] px-4 pb-3 font-mono text-[9px] font-medium tracking-[0.08em] text-[#23231f]/50">
              SHOW THIS CODE WHEN YOU MEET · HIS REAL NAME IS NEVER SHOWN
            </p>

            <TearLine />

            <dl className="relative z-[1] grid grid-cols-2">
              <Cell label="COMPANION" value={companionName} borderRight />
              <Cell label="DURATION" value={durationLabel} />
              <Cell label="DATE" value={dateLabel} borderRight />
              <Cell label="TIME" value={timeLabel} />
              <Cell label="AREA" value={areaLabel} borderRight />
              <Cell label="BOOKED BY" value={bookedByLabel} />
            </dl>

            <div className="relative z-[1] flex items-end justify-between border-b border-dotted border-[#23231f]/20 px-4 pb-3 pt-[13px]">
              <div>
                <div className="mb-1 font-mono text-[8.5px] font-semibold tracking-[0.13em] text-[#23231f]/50">
                  AMOUNT PAID
                </div>
                <div
                  className="font-mono text-[24px] font-bold text-[#23231f]"
                  style={{ textShadow: '0 0 .6px rgba(35,35,31,.45)' }}
                >
                  {amountLabel}
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[9px] font-medium tracking-[0.1em] text-[#23231f]/50">
                  {methodLabel}
                </div>
                <div className="mt-[3px] font-mono text-[9px] font-medium tracking-[0.1em] text-[#23231f]/50">
                  {termsLabel}
                </div>
              </div>
            </div>

            <div className="relative z-[1] px-4 pb-2.5 pt-3">
              <div className="mb-1.5 font-mono text-[8.5px] font-semibold tracking-[0.13em] text-[#23231f]/50">
                CONDUCT — AGREED AT CHECKOUT
              </div>
              <p className="font-sans text-[10.5px] leading-[1.5] text-[#23231f]/70">
                {conductSummary}
              </p>
            </div>

            {/* Lands late, after the stock has finished printing */}
            <div
              aria-hidden
              className="absolute bottom-[128px] right-3 z-[2] animate-stamp rounded border-2 px-[9px] py-[5px] [animation-delay:.35s]"
              style={{
                borderColor: cancelled ? 'rgba(90,90,90,.5)' : 'rgba(200,66,96,.65)',
              }}
            >
              <div
                className="font-mono text-[13px] font-bold tracking-[0.12em]"
                style={{ color: cancelled ? 'rgba(90,90,90,.6)' : 'rgba(200,66,96,.72)' }}
              >
                {cancelled ? 'VOID' : 'PAID'}
              </div>
            </div>

            <div className="relative z-[1] px-4 pb-3.5">
              <Barcode value={reference} />
              <div className="mt-[5px] flex justify-between">
                <span className="font-mono text-[9px] font-medium tracking-[0.22em] text-[#23231f]/60">
                  {reference.replace(/-/g, '')}
                </span>
                <span className="font-mono text-[9px] font-medium tracking-[0.1em] text-[#23231f]/45">
                  alongco.com
                </span>
              </div>
            </div>
          </div>

          <Perforations className="-mt-[5px]" />
        </div>

        {/* The print head sweeping down the stock */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 h-0.5 animate-head bg-[linear-gradient(90deg,rgba(95,211,163,0),rgba(95,211,163,.8),rgba(95,211,163,0))] [animation-delay:.35s]"
        />
      </div>

      <div className="ac-no-print relative mb-3 flex gap-2.5 px-5">
        <Button
          variant="outline"
          size="lg"
          className="flex-1 border-0 bg-white"
          onClick={() => window.print()}
        >
          Save as PDF
        </Button>
        <a
          href={qrDataUrl}
          download={`alongco-${reference}.png`}
          className="flex h-[52px] flex-1 items-center justify-center rounded-lg border border-white/20 bg-white/5 font-sans text-[14px] font-semibold text-white"
        >
          Save QR
        </a>
      </div>
    </>
  )
}

function Cell({
  label,
  value,
  borderRight,
}: {
  label: string
  value: string
  borderRight?: boolean
}) {
  return (
    <div
      className={`border-b border-dotted border-[#23231f]/20 px-4 py-3 ${
        borderRight ? 'border-r' : ''
      }`}
    >
      <dt className="mb-1 font-mono text-[8.5px] font-semibold tracking-[0.13em] text-[#23231f]/50">
        {label}
      </dt>
      <dd className="font-sans text-[14px] font-semibold text-[#23231f]">{value}</dd>
    </div>
  )
}

/** The punched dots along the top and bottom edges of the stock. */
function Perforations({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`relative z-[2] flex h-1.5 justify-between px-1 ${className ?? ''}`}
    >
      {Array.from({ length: 14 }).map((_, i) => (
        <span
          key={i}
          className="-mt-1 h-[9px] w-[9px] rounded-full bg-ink-deep"
        />
      ))}
    </div>
  )
}

/** The tear line, with a notch punched out of each edge. */
function TearLine() {
  return (
    <div aria-hidden className="relative z-[1] h-[15px]">
      <div className="absolute inset-x-0 top-[7px] border-t border-dashed border-[#23231f]/35" />
      <div className="absolute -left-2 top-0 h-[15px] w-[15px] rounded-full bg-ink-deep" />
      <div className="absolute -right-2 top-0 h-[15px] w-[15px] rounded-full bg-ink-deep" />
    </div>
  )
}

/**
 * A deterministic Code-39-flavoured stub. It is decoration, not a scanning
 * surface — the QR is what gets scanned — but it is derived from the reference
 * so two tickets never look alike.
 */
function Barcode({ value }: { value: string }) {
  const bars: number[] = []
  let seed = 0
  for (let i = 0; i < value.length; i++) seed = (seed * 31 + value.charCodeAt(i)) >>> 0
  for (let i = 0; i < 58; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0
    bars.push(1 + ((seed >>> 16) % 3))
  }

  return (
    <svg
      viewBox={`0 0 ${bars.reduce((a, b) => a + b + 1, 0)} 38`}
      preserveAspectRatio="none"
      className="block h-[38px] w-full opacity-[.88] mix-blend-multiply"
      role="presentation"
    >
      {
        bars.reduce<{ x: number; nodes: React.ReactNode[] }>(
          (acc, width, i) => {
            if (i % 2 === 0) {
              acc.nodes.push(
                <rect key={i} x={acc.x} y="0" width={width} height="38" fill="#23231f" />,
              )
            }
            acc.x += width + 1
            return acc
          },
          { x: 0, nodes: [] },
        ).nodes
      }
    </svg>
  )
}
