// Error-tracking abstraction. Disabled by default — captureException() is a
// no-op (beyond a structured log line) unless ERROR_TRACKING_DSN is set, so
// adopting this never silently starts sending data (including potentially
// customer-derived data in stack traces/breadcrumbs) to an external
// provider without an explicit operator decision.
//
// Intentionally has no provider SDK dependency yet. When ready to wire up a
// real provider (Sentry is the natural fit for Next.js — see
// docs/security/VULNERABILITY_MANAGEMENT.md), implement `send()` below and
// keep this same call-site API so nothing else in the app needs to change.
import { logger, redact } from './logger'

interface CaptureContext {
  requestId?: string
  userId?: string
  orgId?: string
  bankId?: string
  route?: string
  [key: string]: unknown
}

function isEnabled(): boolean {
  return Boolean(process.env.ERROR_TRACKING_DSN)
}

async function send(error: unknown, context?: CaptureContext): Promise<void> {
  // Placeholder for a real provider integration (e.g. Sentry's
  // captureException). Deliberately unimplemented — see file header.
  // Until wired up, this function is unreachable (isEnabled() gates every
  // call site below), so there is no dead network call to worry about.
  void error
  void context
}

export function captureException(error: unknown, context?: CaptureContext): void {
  logger.error(
    error instanceof Error ? error.message : String(error),
    { ...context, stack: error instanceof Error ? error.stack : undefined }
  )

  if (!isEnabled()) return

  void send(error, context).catch(sendErr => {
    // Never let error-tracking itself break the request it's instrumenting.
    logger.warn('error-tracking send failed', { sendErr: redact(sendErr) })
  })
}

export function captureMessage(message: string, context?: CaptureContext): void {
  logger.warn(message, context)
  if (!isEnabled()) return
  void send(new Error(message), context).catch(sendErr => {
    logger.warn('error-tracking send failed', { sendErr: redact(sendErr) })
  })
}
