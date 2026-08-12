// Regression tests for PR 1b: counterOffer()/acceptOffer() are the shared
// implementation called by the human HTTP route AND directly by the AI tool
// handlers (lib/ai/tools/handlers/{counter,accept}-marketplace-offer.ts) and,
// through them, Strike AI chat, /api/ai/dispatch, and the autonomous
// negotiation tick loop. Gating admission only at the HTTP route (as PR 1a
// did) left every one of those callers able to advance a negotiation for a
// non-admitted org — these tests exercise the REAL functions, unmocked,
// to prove the gate is actually enforced at the one place all callers share.
import { describe, expect, it, beforeEach, vi } from 'vitest'

interface TableResponse { data: unknown; error?: unknown }

const state: { tables: Record<string, TableResponse> } = { tables: {} }
// Per-org-id override for the 'organizations' table — lets a single test
// give two different orgs two different admission statuses, which a single
// static per-table stub can't express. Unset (null) means "fall back to
// state.tables.organizations" (the existing single-response behavior).
const orgsById: { current: Record<string, { status: string; kyb_status: string }> | null } = { current: null }
const updateSpy = vi.fn()

function createChain(table: string, response: TableResponse) {
  let lastEqId: string | null = null
  const chain: Record<string, unknown> = {}
  const chainMethods = ['select', 'order', 'limit', 'not', 'in', 'contains', 'insert', 'delete', 'single', 'maybeSingle']
  for (const method of chainMethods) {
    chain[method] = () => chain
  }
  chain.eq = (col: string, val: string) => {
    if (col === 'id') lastEqId = val
    return chain
  }
  chain.update = (payload: unknown) => {
    updateSpy(table, payload)
    return chain
  }
  ;(chain as { then: unknown }).then = (
    resolve: (value: TableResponse) => void
  ) => {
    if (table === 'organizations' && orgsById.current) {
      resolve({ data: lastEqId ? (orgsById.current[lastEqId] ?? null) : null })
      return
    }
    resolve(response)
  }
  return chain
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => createChain(table, state.tables[table] ?? { data: null, error: null }),
  }),
}))

vi.mock('@/lib/ai', () => ({
  callClaude: async () => ({ text: 'Fine.', usage: { input_tokens: 1, output_tokens: 1 } }),
  AI_MODEL: 'test-model',
}))

const baseListingRow = {
  id: 'listing-1', status: 'active', org_id: 'listing-org', title: 'Test listing',
  target_price: 100, currency: 'USD', offer_count: 1, listing_type: 'po_request', shipping_cost: null,
}

const baseOffer = {
  id: 'offer-1',
  from_org_id: 'offeror-org',
  status: 'pending',
  offer_rounds: [],
  current_round: 1,
  offered_price: 100,
  metadata: {},
  marketplace_listings: baseListingRow,
}

beforeEach(() => {
  state.tables = {}
  orgsById.current = null
  updateSpy.mockClear()
})

describe('counterOffer() — admission enforcement (PR 1b)', () => {
  const nonAdmittedCases: Array<{ label: string; status: string; kyb_status: string }> = [
    { label: 'submitted', status: 'kyb_submitted', kyb_status: 'submitted' },
    { label: 'rejected', status: 'rejected', kyb_status: 'rejected' },
    { label: 'suspended', status: 'suspended', kyb_status: 'approved' },
  ]

  for (const { label, status, kyb_status } of nonAdmittedCases) {
    it(`throws AdmissionError when the acting org is ${label}, before any write`, async () => {
      const { counterOffer, AdmissionError } = await import('./offer-actions')

      state.tables.marketplace_offers = { data: baseOffer }
      state.tables.organizations = { data: { status, kyb_status } }

      await expect(
        counterOffer({ offerId: 'offer-1', actingOrgId: 'offeror-org', terms: { offered_price: 90 } })
      ).rejects.toThrow(AdmissionError)

      expect(updateSpy).not.toHaveBeenCalled()
    })
  }

  it('does not throw AdmissionError when the acting org is approved and active (it is the listing owner\'s turn to counter, so this exercises the real turn-order check next)', async () => {
    const { counterOffer } = await import('./offer-actions')

    state.tables.marketplace_offers = { data: baseOffer }
    state.tables.organizations = { data: { status: 'active', kyb_status: 'approved', legal_name: 'Test Org' } }
    state.tables.users = { data: [{ id: 'user-1' }] }
    state.tables.rooms = { data: { id: 'room-1' } }
    state.tables.room_participants = { data: null }
    state.tables.notifications = { data: null }
    state.tables.ai_usage = { data: null }

    // baseOffer has no offer_rounds yet, so it's the LISTING OWNER's turn —
    // use listing-org as the acting org so this clears turn-order too and
    // actually reaches (and passes through) the admission check on a
    // real, unmocked execution path.
    await expect(
      counterOffer({ offerId: 'offer-1', actingOrgId: 'listing-org', terms: { offered_price: 90 } })
    ).resolves.not.toThrow()
  })
})

describe('acceptOffer() — admission enforcement (PR 1b)', () => {
  it('throws AdmissionError for a rejected acting org, after the party check but before any write', async () => {
    const { acceptOffer, AdmissionError } = await import('./offer-actions')

    state.tables.marketplace_offers = { data: baseOffer }
    state.tables.organizations = { data: { status: 'rejected', kyb_status: 'rejected' } }

    await expect(
      acceptOffer({ offerId: 'offer-1', actingOrgId: 'offeror-org' })
    ).rejects.toThrow(AdmissionError)

    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('still enforces party membership before admission (a non-party org is denied for the right reason)', async () => {
    const { acceptOffer, InvalidStateError } = await import('./offer-actions')

    state.tables.marketplace_offers = { data: baseOffer }
    // No 'organizations' stub — if admission were checked first this would
    // wrongly surface as AdmissionError instead of the party-membership error.

    await expect(
      acceptOffer({ offerId: 'offer-1', actingOrgId: 'some-other-org' })
    ).rejects.toThrow(InvalidStateError)
  })

  it('PR 3: blocks acceptance when the OTHER party (not the acting org) is non-admitted — admission changing after a recommendation but before approval must block acceptance', async () => {
    const { acceptOffer, AdmissionError } = await import('./offer-actions')

    state.tables.marketplace_offers = { data: baseOffer }
    // The acting org (listing-org, the buyer approving an award
    // recommendation) is admitted; the counterparty (offeror-org, the
    // supplier) is NOT — e.g. suspended between recommendation and approval.
    orgsById.current = {
      'listing-org': { status: 'active', kyb_status: 'approved' },
      'offeror-org': { status: 'suspended', kyb_status: 'approved' },
    }

    await expect(
      acceptOffer({ offerId: 'offer-1', actingOrgId: 'listing-org' })
    ).rejects.toThrow(AdmissionError)
  })
})

describe('rejectOffer() — deliberately NOT admission-gated', () => {
  it('a non-admitted listing owner can still reject an incoming offer', async () => {
    const { rejectOffer, AdmissionError } = await import('./offer-actions')

    state.tables.marketplace_offers = { data: baseOffer }
    state.tables.users = { data: [] }
    // No 'organizations' stub consulted — rejectOffer must never look up
    // admission status at all.

    let threwAdmissionError = false
    try {
      await rejectOffer({ offerId: 'offer-1', actingOrgId: 'listing-org' })
    } catch (err) {
      if (err instanceof AdmissionError) threwAdmissionError = true
    }
    expect(threwAdmissionError).toBe(false)
  })
})
