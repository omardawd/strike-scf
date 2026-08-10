import { afterEach, describe, expect, it } from 'vitest'
import { assertDemoRoutesEnabled, demoRoutesEnabled, isDemoAccount, DEMO_EMAIL } from './demo'

describe('isDemoAccount', () => {
  it('matches only the exact demo email', () => {
    expect(isDemoAccount(DEMO_EMAIL)).toBe(true)
    expect(isDemoAccount('DEMO@DEMO.COM')).toBe(false)
    expect(isDemoAccount('someone@else.com')).toBe(false)
    expect(isDemoAccount(null)).toBe(false)
    expect(isDemoAccount(undefined)).toBe(false)
  })
})

describe('demoRoutesEnabled / assertDemoRoutesEnabled', () => {
  const originalValue = process.env.DEMO_ROUTES_ENABLED

  afterEach(() => {
    if (originalValue === undefined) delete process.env.DEMO_ROUTES_ENABLED
    else process.env.DEMO_ROUTES_ENABLED = originalValue
  })

  it('defaults to disabled when the env var is unset', () => {
    delete process.env.DEMO_ROUTES_ENABLED
    expect(demoRoutesEnabled()).toBe(false)
  })

  it('stays disabled for any value other than the literal string "true"', () => {
    for (const value of ['1', 'yes', 'True', 'TRUE', '']) {
      process.env.DEMO_ROUTES_ENABLED = value
      expect(demoRoutesEnabled()).toBe(false)
    }
  })

  it('is enabled only when set to exactly "true"', () => {
    process.env.DEMO_ROUTES_ENABLED = 'true'
    expect(demoRoutesEnabled()).toBe(true)
  })

  it('returns a 404 guard response when disabled', async () => {
    delete process.env.DEMO_ROUTES_ENABLED
    const guard = assertDemoRoutesEnabled()
    expect(guard).not.toBeNull()
    expect(guard?.status).toBe(404)
  })

  it('returns null (no guard) when enabled', () => {
    process.env.DEMO_ROUTES_ENABLED = 'true'
    expect(assertDemoRoutesEnabled()).toBeNull()
  })
})
