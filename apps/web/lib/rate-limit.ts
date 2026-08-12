import { NextResponse } from 'next/server'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

const memoryStore = new Map<string, { count: number; resetAt: number }>()

function memoryRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  const record = memoryStore.get(key)

  if (!record || now > record.resetAt) {
    const resetAt = now + windowMs
    memoryStore.set(key, { count: 1, resetAt })
    return { allowed: true, remaining: limit - 1, resetAt }
  }

  if (record.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: record.resetAt }
  }

  record.count++
  return { allowed: true, remaining: limit - record.count, resetAt: record.resetAt }
}

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

async function upstashRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  // Fixed-window counter: INCR a window-scoped key, EXPIRE it to the window
  // length. Simpler and cheaper than a sliding-window/token-bucket algorithm;
  // the tradeoff (allows up to 2x `limit` requests across a window boundary)
  // is acceptable for abuse prevention, not billing-grade metering.
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000))
  const windowIndex = Math.floor(Date.now() / windowMs)
  const redisKey = `ratelimit:${key}:${windowIndex}`

  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      ['INCR', redisKey],
      ['EXPIRE', redisKey, String(windowSeconds)],
    ]),
  })

  if (!res.ok) {
    throw new Error(`Upstash rate-limit request failed: ${res.status}`)
  }

  const results = await res.json() as Array<{ result: number }>
  const count = results[0]?.result ?? 0
  const resetAt = (windowIndex + 1) * windowMs

  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetAt,
  }
}

/**
 * Rate-limits by an arbitrary key. Callers must derive `key` from something
 * the caller cannot forge — an authenticated user/org id, a validated
 * external token's owning org, or (for unauthenticated routes) the
 * platform-injected client IP (see lib/request-ip.ts) — never a raw
 * client-supplied header or body field.
 *
 * Uses Upstash Redis (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN) when
 * configured — the only mode that enforces limits correctly across Vercel's
 * multiple serverless instances. Falls back to an in-memory counter
 * otherwise: fine for local dev, NOT safe as the sole control in a real
 * multi-instance deployment (resets on cold start, not shared across
 * instances) — configure Upstash before depending on this in production.
 * On any Upstash request failure, fails OPEN (allows the request) so a
 * rate-limiter outage never takes down the endpoints it's protecting.
 */
export async function rateLimit(
  key: string,
  limit: number = 20,
  windowMs: number = 60_000
): Promise<RateLimitResult> {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    try {
      return await upstashRateLimit(key, limit, windowMs)
    } catch (err) {
      console.error('[rate-limit] Upstash request failed, failing open:', err)
      return { allowed: true, remaining: limit, resetAt: Date.now() + windowMs }
    }
  }
  return memoryRateLimit(key, limit, windowMs)
}

/** Standard 429 response with Retry-After for a route that hit its limit. */
export function rateLimitResponse(result: RateLimitResult): NextResponse {
  const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))
  return NextResponse.json(
    { error: 'Too many requests', retry_after_seconds: retryAfterSeconds },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
  )
}
