import { describe, expect, it } from 'vitest'
import { getClientIp } from './request-ip'

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request('https://example.com', { headers })
}

describe('getClientIp', () => {
  it('takes the first IP from x-forwarded-for', () => {
    const req = requestWithHeaders({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' })
    expect(getClientIp(req)).toBe('203.0.113.5')
  })

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const req = requestWithHeaders({ 'x-real-ip': '198.51.100.7' })
    expect(getClientIp(req)).toBe('198.51.100.7')
  })

  it('returns "unknown" when neither header is present', () => {
    const req = requestWithHeaders({})
    expect(getClientIp(req)).toBe('unknown')
  })
})
