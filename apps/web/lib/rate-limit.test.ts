import { describe, expect, it, vi } from 'vitest'
import { rateLimit, rateLimitResponse } from './rate-limit'

// UPSTASH_REDIS_REST_URL/TOKEN are unset in the test environment, so these
// exercise the in-memory fallback path exclusively — the Upstash path needs
// a live/mocked Redis and is out of scope for a unit test.

describe('rateLimit (in-memory fallback)', () => {
  it('allows requests up to the limit, then denies', async () => {
    const key = `test:${crypto.randomUUID()}`
    for (let i = 0; i < 3; i++) {
      const result = await rateLimit(key, 3, 60_000)
      expect(result.allowed).toBe(true)
    }
    const denied = await rateLimit(key, 3, 60_000)
    expect(denied.allowed).toBe(false)
    expect(denied.remaining).toBe(0)
  })

  it('tracks separate keys independently', async () => {
    const keyA = `test:${crypto.randomUUID()}`
    const keyB = `test:${crypto.randomUUID()}`
    await rateLimit(keyA, 1, 60_000)
    const secondA = await rateLimit(keyA, 1, 60_000)
    const firstB = await rateLimit(keyB, 1, 60_000)
    expect(secondA.allowed).toBe(false)
    expect(firstB.allowed).toBe(true)
  })

  it('resets after the window elapses', async () => {
    vi.useFakeTimers()
    try {
      const key = `test:${crypto.randomUUID()}`
      const first = await rateLimit(key, 1, 1000)
      expect(first.allowed).toBe(true)
      const second = await rateLimit(key, 1, 1000)
      expect(second.allowed).toBe(false)

      vi.advanceTimersByTime(1001)

      const third = await rateLimit(key, 1, 1000)
      expect(third.allowed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('rateLimitResponse', () => {
  it('returns 429 with a Retry-After header', () => {
    const response = rateLimitResponse({ allowed: false, remaining: 0, resetAt: Date.now() + 30_000 })
    expect(response.status).toBe(429)
    const retryAfter = Number(response.headers.get('Retry-After'))
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(30)
  })
})
