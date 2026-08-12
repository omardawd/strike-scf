import { describe, expect, it } from 'vitest'
import { redact } from './logger'

describe('redact', () => {
  it('redacts known-sensitive keys at the top level', () => {
    const result = redact({ password: 'hunter2', username: 'alice' }) as Record<string, unknown>
    expect(result.password).toBe('[REDACTED]')
    expect(result.username).toBe('alice')
  })

  it('redacts nested sensitive keys', () => {
    const result = redact({
      user: { id: '1', api_key: 'sk-live-abc123' },
    }) as { user: { id: string; api_key: string } }
    expect(result.user.api_key).toBe('[REDACTED]')
    expect(result.user.id).toBe('1')
  })

  it('redacts sensitive keys inside arrays of objects', () => {
    const result = redact([
      { dispatch_token: 'abc' },
      { name: 'ok' },
    ]) as Array<Record<string, unknown>>
    expect(result[0]!.dispatch_token).toBe('[REDACTED]')
    expect(result[1]!.name).toBe('ok')
  })

  it('matches sensitive keys case-insensitively and by substring', () => {
    const result = redact({
      BANK_ROUTING_NUMBER: '123456789',
      accountNumberDisplay: '****1234',
      Authorization: 'Bearer xyz',
    }) as Record<string, unknown>
    expect(result.BANK_ROUTING_NUMBER).toBe('[REDACTED]')
    expect(result.accountNumberDisplay).toBe('[REDACTED]')
    expect(result.Authorization).toBe('[REDACTED]')
  })

  it('serializes Error objects without leaking arbitrary enumerable props as unredacted', () => {
    const err = new Error('boom')
    const result = redact(err) as { name: string; message: string }
    expect(result.name).toBe('Error')
    expect(result.message).toBe('boom')
  })

  it('leaves non-sensitive primitives and null/undefined untouched', () => {
    expect(redact('hello')).toBe('hello')
    expect(redact(42)).toBe(42)
    expect(redact(null)).toBe(null)
    expect(redact(undefined)).toBe(undefined)
  })
})
