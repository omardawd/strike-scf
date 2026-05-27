const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(
  key: string,
  limit: number = 20,
  windowMs: number = 60 * 1000
): { allowed: boolean; remaining: number } {
  const now = Date.now()
  const record = rateLimitStore.get(key)

  if (!record || now > record.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: limit - 1 }
  }

  if (record.count >= limit) {
    return { allowed: false, remaining: 0 }
  }

  record.count++
  return { allowed: true, remaining: limit - record.count }
}
