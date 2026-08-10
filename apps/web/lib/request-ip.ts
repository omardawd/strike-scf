/**
 * Best-effort client IP for unauthenticated routes that need a rate-limit
 * key. On Vercel, `x-forwarded-for` is set by the platform's edge network,
 * not forwardable/spoofable by the end client — safe to trust in that
 * environment. Falls back to 'unknown' (all unattributed traffic then
 * shares one bucket) rather than throwing, since this is only ever used
 * for abuse-prevention keying, never for security decisions.
 */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) return forwardedFor.split(',')[0]!.trim()

  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp.trim()

  return 'unknown'
}
