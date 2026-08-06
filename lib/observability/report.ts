import 'server-only'

/**
 * Error reporting. TASKS T22.
 *
 * One seam that every failure worth waking someone for goes through, so there
 * is a single place to attach Sentry (or anything else) rather than a scatter of
 * console.error calls that nobody is watching.
 *
 * Two rules this enforces on its callers:
 *
 *  1. Nothing sensitive leaves. Context is allow-listed to scalars and passed
 *     through a redactor — a phone number, a real name or a payment payload must
 *     never reach a log line or an error tracker (CLAUDE.md §9).
 *  2. Reporting never throws. A monitoring failure must not become an outage on
 *     the webhook or cron path.
 *
 * To wire up Sentry: `npm i @sentry/nextjs`, set SENTRY_DSN, and forward from
 * `emit` below. Everything else already calls through here.
 */

export type Severity = 'warning' | 'error' | 'critical'

/**
 * Failures that mean money or a booking is in an unknown state. These are what
 * should page someone, as opposed to the ordinary noise of a web app.
 */
export type Channel =
  | 'webhook' // Cashfree told us something and we could not process it
  | 'cron' // holds are not expiring, or bookings are not completing
  | 'refund' // money owed and not sent
  | 'payment' // order creation failed
  | 'auth' // OTP delivery is down
  | 'app'

export type ReportContext = Record<string, string | number | boolean | null | undefined>

/** Keys that must never carry a value into a log, whatever a caller passes. */
const FORBIDDEN = /phone|mobile|name|email|otp|token|secret|key|signature|payload|address/i

function redact(context: ReportContext): Record<string, unknown> {
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue
    safe[key] = FORBIDDEN.test(key) ? '[redacted]' : value
  }
  return safe
}

export function report(
  channel: Channel,
  message: string,
  options: {
    severity?: Severity
    error?: unknown
    context?: ReportContext
  } = {},
): void {
  try {
    const { severity = 'error', error, context = {} } = options

    const entry = {
      channel,
      severity,
      message,
      // The message of an Error is ours; its stack can carry request data, so
      // only the message crosses this boundary.
      cause: error instanceof Error ? error.message : error ? String(error) : undefined,
      ...redact(context),
    }

    emit(severity, entry)
  } catch {
    // Reporting must never be the thing that breaks the request.
  }
}

function emit(severity: Severity, entry: Record<string, unknown>): void {
  // Structured single-line JSON: greppable in Vercel logs and parseable by a
  // log drain without a custom decoder.
  const line = JSON.stringify(entry)
  if (severity === 'warning') console.warn(line)
  else console.error(line)

  // Sentry goes here once a DSN exists:
  //   Sentry.captureMessage(entry.message, { level, extra: entry })
}

/**
 * Convenience for the two paths PRD T22 calls out by name. Both are unattended
 * — nobody is watching a screen when they fail — so they are always critical.
 */
export function reportWebhookFailure(
  message: string,
  context: ReportContext = {},
  error?: unknown,
): void {
  report('webhook', message, { severity: 'critical', context, error })
}

export function reportCronFailure(
  job: string,
  context: ReportContext = {},
  error?: unknown,
): void {
  report('cron', `cron job failed: ${job}`, {
    severity: 'critical',
    context: { job, ...context },
    error,
  })
}
