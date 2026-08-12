import { describe, expect, it, vi } from 'vitest'

// These helpers are pure comparison logic and never touch the network, but
// resource-access.ts/session.ts construct a real Supabase client at module
// scope (the same pattern every route in the app uses) — mock it so
// importing them in a unit test doesn't attempt a real connection.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({}) }),
}))

import {
  canAccessOwnOrganization,
  canBankAccessOrganization,
  canAccessOwnBank,
  canAccessDealParty,
} from './resource-access'
import type { SessionContext } from './session'

function ctx(overrides: Partial<SessionContext>): SessionContext {
  return { userId: 'u1', role: 'org_admin', orgId: null, bankId: null, ...overrides }
}

describe('canAccessOwnOrganization', () => {
  it('allows the org matching the caller own org', () => {
    expect(canAccessOwnOrganization(ctx({ orgId: 'org-1' }), 'org-1')).toBe(true)
  })
  it('denies a different org', () => {
    expect(canAccessOwnOrganization(ctx({ orgId: 'org-1' }), 'org-2')).toBe(false)
  })
  it('strike_admin always passes regardless of orgId', () => {
    expect(canAccessOwnOrganization(ctx({ role: 'strike_admin', orgId: null }), 'org-2')).toBe(true)
  })
})

describe('canBankAccessOrganization', () => {
  it('allows when the bank ids match (via primary_bank_id)', () => {
    expect(canBankAccessOrganization(ctx({ role: 'bank_admin', bankId: 'bank-A' }), 'bank-A')).toBe(true)
  })
  it('denies a different bank — the P0-1 regression scenario', () => {
    expect(canBankAccessOrganization(ctx({ role: 'bank_admin', bankId: 'bank-A' }), 'bank-B')).toBe(false)
  })
  it('denies when either id is null', () => {
    expect(canBankAccessOrganization(ctx({ role: 'bank_admin', bankId: null }), 'bank-A')).toBe(false)
    expect(canBankAccessOrganization(ctx({ role: 'bank_admin', bankId: 'bank-A' }), null)).toBe(false)
  })
  it('strike_admin always passes', () => {
    expect(canBankAccessOrganization(ctx({ role: 'strike_admin', bankId: null }), null)).toBe(true)
  })
})

describe('canAccessOwnBank', () => {
  it('allows only the caller own bank', () => {
    expect(canAccessOwnBank(ctx({ role: 'bank_admin', bankId: 'bank-A' }), 'bank-A')).toBe(true)
    expect(canAccessOwnBank(ctx({ role: 'bank_admin', bankId: 'bank-A' }), 'bank-B')).toBe(false)
  })
})

describe('canAccessDealParty', () => {
  const deal = { buyer_org_id: 'org-buyer', supplier_org_id: 'org-supplier' }

  it('allows the buyer org', () => {
    expect(canAccessDealParty(ctx({ orgId: 'org-buyer' }), deal)).toBe(true)
  })
  it('allows the supplier org', () => {
    expect(canAccessDealParty(ctx({ orgId: 'org-supplier' }), deal)).toBe(true)
  })
  it('denies an unrelated org', () => {
    expect(canAccessDealParty(ctx({ orgId: 'org-other' }), deal)).toBe(false)
  })
  it('strike_admin always passes', () => {
    expect(canAccessDealParty(ctx({ role: 'strike_admin', orgId: null }), deal)).toBe(true)
  })
})
