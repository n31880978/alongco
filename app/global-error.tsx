'use client'

/**
 * The last resort: an error in the root layout itself, where the normal
 * boundary and the app's own <html> never render. This file has to supply both
 * tags, and cannot rely on globals.css having loaded — so the styling here is
 * inline on purpose rather than Tailwind.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en-IN">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#FBFAF7',
          color: '#16161A',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: '24px',
        }}
      >
        <main style={{ maxWidth: '420px' }}>
          <p
            style={{
              margin: '0 0 8px',
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.12em',
              color: '#C7456B',
            }}
          >
            ALONGCO
          </p>
          <h1
            style={{
              margin: '0 0 12px',
              fontSize: '26px',
              fontWeight: 400,
              lineHeight: 1.2,
            }}
          >
            The site failed to load
          </h1>
          <p
            style={{
              margin: '0 0 20px',
              fontSize: '14px',
              lineHeight: 1.6,
              color: 'rgba(22,22,26,.7)',
            }}
          >
            Nothing has been charged. A booking is only paid once you have reached the
            ticket screen — if you have no ticket, no payment completed.
          </p>
          <button
            onClick={reset}
            style={{
              appearance: 'none',
              border: 0,
              borderRadius: '8px',
              backgroundColor: '#16161A',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 600,
              padding: '14px 20px',
              width: '100%',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
          {error.digest && (
            <p
              style={{
                margin: '16px 0 0',
                fontSize: '12px',
                color: 'rgba(22,22,26,.45)',
              }}
            >
              Reference {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  )
}
