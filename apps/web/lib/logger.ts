// Structured server logger. Emits single-line JSON to stdout/stderr — the
// shape Vercel's log pipeline (and any downstream drain configured per
// docs/security/VULNERABILITY_MANAGEMENT.md / the manual infra checklist)
// expects. Not a replacement for an APM/log-aggregation product — it's the
// structured-output layer that makes adding one later a config change
// rather than an instrumentation rewrite.

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

// Key names (case-insensitive substring match) that must never appear in a
// logged value verbatim. Deliberately broad — false positives (redacting a
// field that turns out to be harmless) are cheap; false negatives (leaking
// a real secret into logs, which then live in a retained log drain
// indefinitely) are not.
const SENSITIVE_KEY_PATTERNS = [
  'password', 'secret', 'token', 'api_key', 'apikey', 'authorization',
  'dispatch_token', 'service_role', 'encrypted_password',
  'account_number', 'routing_number', 'bank_account', 'swift_iban',
  'ssn', 'tax_id', 'ein', 'credit_card', 'card_number', 'cvv',
  'storage_path', 'signed_url', // document access details — see AI_GOVERNANCE.md
  'prompt', 'reasoning', 'input_summary', 'output_summary', // raw AI I/O — may contain the above
]

const REDACTED = '[REDACTED]'
const MAX_DEPTH = 6

// Strips non-letters so snake_case, camelCase, and SCREAMING_CASE keys
// (bank_routing_number / bankRoutingNumber / BANK_ROUTING_NUMBER) all match
// the same pattern list.
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, '')
}

const NORMALIZED_PATTERNS = SENSITIVE_KEY_PATTERNS.map(normalizeKey)

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key)
  return NORMALIZED_PATTERNS.some(pattern => normalized.includes(pattern))
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[MAX_DEPTH]'
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1))
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack }
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redact(val, depth + 1)
    }
    return out
  }
  return value
}

interface LogContext {
  requestId?: string
  userId?: string
  orgId?: string
  bankId?: string
  route?: string
  [key: string]: unknown
}

function emit(level: LogLevel, message: string, context?: LogContext) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  }
  const line = JSON.stringify(entry)
  if (level === 'error' || level === 'warn') {
    console.error(line)
  } else {
    console.log(line)
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit('debug', message, context),
  info: (message: string, context?: LogContext) => emit('info', message, context),
  warn: (message: string, context?: LogContext) => emit('warn', message, context),
  error: (message: string, context?: LogContext) => emit('error', message, context),
}

// Exposed for tests and for any call site that needs to redact a payload
// before doing something with it other than logging (e.g. before storing a
// snapshot for debugging).
export { redact }
