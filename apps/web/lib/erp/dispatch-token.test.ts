import { describe, expect, it } from 'vitest'
import {
  generateDispatchToken,
  hashDispatchToken,
  isDispatchTokenValid,
  dispatchTokenHasScope,
} from './dispatch-token'

describe('generateDispatchToken', () => {
  it('produces a token whose hash matches hashDispatchToken(token)', () => {
    const { token, hash } = generateDispatchToken()
    expect(hashDispatchToken(token)).toBe(hash)
  })

  it('produces a prefix that is the first 8 chars of the raw token', () => {
    const { token, prefix } = generateDispatchToken()
    expect(prefix).toBe(token.slice(0, 8))
    expect(prefix).toHaveLength(8)
  })

  it('never generates the same token twice', () => {
    const a = generateDispatchToken()
    const b = generateDispatchToken()
    expect(a.token).not.toBe(b.token)
  })

  it('is a 64-char hex string (32 random bytes)', () => {
    const { token } = generateDispatchToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('isDispatchTokenValid', () => {
  const base = {
    status: 'active',
    dispatch_token_revoked_at: null,
    dispatch_token_expires_at: null,
    dispatch_token_scopes: ['*'],
  }

  it('is valid when active, unrevoked, unexpired', () => {
    expect(isDispatchTokenValid(base)).toBe(true)
  })

  it('is invalid when connection status is not active', () => {
    expect(isDispatchTokenValid({ ...base, status: 'disconnected' })).toBe(false)
    expect(isDispatchTokenValid({ ...base, status: 'error' })).toBe(false)
  })

  it('is invalid when revoked', () => {
    expect(isDispatchTokenValid({ ...base, dispatch_token_revoked_at: new Date().toISOString() })).toBe(false)
  })

  it('is invalid when expired', () => {
    const past = new Date(Date.now() - 1000).toISOString()
    expect(isDispatchTokenValid({ ...base, dispatch_token_expires_at: past })).toBe(false)
  })

  it('is valid when expires_at is in the future', () => {
    const future = new Date(Date.now() + 1000 * 60 * 60).toISOString()
    expect(isDispatchTokenValid({ ...base, dispatch_token_expires_at: future })).toBe(true)
  })
})

describe('dispatchTokenHasScope', () => {
  it('grants any scope when scopes includes "*"', () => {
    const row = { status: 'active', dispatch_token_revoked_at: null, dispatch_token_expires_at: null, dispatch_token_scopes: ['*'] }
    expect(dispatchTokenHasScope(row, 'anything')).toBe(true)
  })

  it('grants only listed scopes otherwise', () => {
    const row = { status: 'active', dispatch_token_revoked_at: null, dispatch_token_expires_at: null, dispatch_token_scopes: ['read'] }
    expect(dispatchTokenHasScope(row, 'read')).toBe(true)
    expect(dispatchTokenHasScope(row, 'write')).toBe(false)
  })

  it('defaults to "*" when scopes is null', () => {
    const row = { status: 'active', dispatch_token_revoked_at: null, dispatch_token_expires_at: null, dispatch_token_scopes: null }
    expect(dispatchTokenHasScope(row, 'anything')).toBe(true)
  })
})
