// Regression tests for PR 1 (org-admission enforcement): this route's PATCH
// handler (accept/counter/reject/withdraw/create_room) previously had NO
// admission check at all — a rejected/suspended org could accept an offer
// and create a deal.
//
// 'counter'/'accept' are gated INSIDE counterOffer()/acceptOffer()
// (lib/marketplace/offer-actions.ts — see offer-actions.test.ts for the real,
// unmocked coverage of that check) because those shared functions are also
// called directly by the AI tool handlers and the autonomous tick loop, not
// just this route. Here we only verify the route correctly translates an
// AdmissionError raised by that shared layer into a 403. 'create_room' has no
// shared function to gate, so it keeps its own route-level pre-check, tested
// directly. reject/withdraw are exempt everywhere (declining never needs
// approval).
import { describe, expect, it, beforeEach, vi } from 'vitest'

interface MockUser { id: string }
interface TableResponse { data: unknown; error?: unknown }

const state: {
  currentUser: MockUser | null
  tables: Record<string, TableResponse>
} = { currentUser: null, tables: {} }

function createChain(response: TableResponse) {
  const chain: Record<string, unknown> = {}
  const chainMethods = ['select', 'eq', 'order', 'limit', 'not', 'in', 'contains', 'update', 'insert', 'delete', 'single', 'maybeSingle']
  for (const method of chainMethods) {
    chain[method] = () => chain
  }
  ;(chain as { then: unknown }).then = (
    resolve: (value: TableResponse) => void
  ) => resolve(response)
  return chain
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => createChain(state.tables[table] ?? { data: null, error: null }),
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.currentUser } }),
    },
  }),
}))

class MockAdmissionError extends Error {}
class MockTurnOrderError extends Error {}
class MockInvalidStateError extends Error {}

const shouldDenyAdmission = { current: false }

const offerActionMocks = {
  ensureRoom: vi.fn(async () => 'room-1'),
  counterOffer: vi.fn(async () => {
    if (shouldDenyAdmission.current) throw new MockAdmissionError('Organization must be KYB-approved to do this')
    return { offer: { id: 'offer-1', status: 'countered' }, roomId: 'room-1' }
  }),
  acceptOffer: vi.fn(async () => {
    if (shouldDenyAdmission.current) throw new MockAdmissionError('Organization must be KYB-approved to do this')
    return { offer: { id: 'offer-1', status: 'accepted' }, deal: { id: 'deal-1' } }
  }),
  rejectOffer: vi.fn(async () => ({ offer: { id: 'offer-1', status: 'rejected' } })),
}

vi.mock('@/lib/marketplace/offer-actions', () => ({
  ensureRoom: (...args: Parameters<typeof offerActionMocks.ensureRoom>) => offerActionMocks.ensureRoom(...args),
  counterOffer: (...args: Parameters<typeof offerActionMocks.counterOffer>) => offerActionMocks.counterOffer(...args),
  acceptOffer: (...args: Parameters<typeof offerActionMocks.acceptOffer>) => offerActionMocks.acceptOffer(...args),
  rejectOffer: (...args: Parameters<typeof offerActionMocks.rejectOffer>) => offerActionMocks.rejectOffer(...args),
  TurnOrderError: MockTurnOrderError,
  InvalidStateError: MockInvalidStateError,
  AdmissionError: MockAdmissionError,
}))

function patchRequest(body: unknown): Request {
  return new Request('https://example.com/api/marketplace/offers/offer-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

const baseOffer = {
  id: 'offer-1',
  from_org_id: 'offeror-org',
  status: 'pending',
  metadata: {},
  marketplace_listings: {
    id: 'listing-1', status: 'active', org_id: 'listing-org', title: 'Test listing',
    target_price: 100, currency: 'USD', offer_count: 1, listing_type: 'po_request', shipping_cost: null,
  },
}

beforeEach(() => {
  state.currentUser = null
  state.tables = {}
  shouldDenyAdmission.current = false
  vi.clearAllMocks()
})

describe('PATCH /api/marketplace/offers/[id] — admission enforcement (PR 1)', () => {
  for (const action of ['counter', 'accept'] as const) {
    it(`translates an AdmissionError from ${action === 'counter' ? 'counterOffer' : 'acceptOffer'}() into a 403`, async () => {
      const { PATCH } = await import('./route')

      state.currentUser = { id: 'user-1' }
      state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'offeror-org' } }
      state.tables.marketplace_offers = { data: baseOffer }
      shouldDenyAdmission.current = true

      const res = await PATCH(patchRequest({ action, offered_price: 90 }), { params: Promise.resolve({ id: 'offer-1' }) })
      expect(res.status).toBe(403)
      const json = await res.json()
      expect(json.error).toMatch(/KYB-approved/i)
    })

    it(`allows action='${action}' through to the shared function when admitted`, async () => {
      const { PATCH } = await import('./route')

      state.currentUser = { id: 'user-1' }
      state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'offeror-org' } }
      state.tables.marketplace_offers = { data: baseOffer }
      shouldDenyAdmission.current = false

      const res = await PATCH(patchRequest({ action, offered_price: 90 }), { params: Promise.resolve({ id: 'offer-1' }) })
      expect(res.status).not.toBe(403)
    })
  }

  it("denies action='create_room' from a non-admitted caller org (submitted KYB) via its own route-level check", async () => {
    const { PATCH } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'offeror-org' } }
    state.tables.marketplace_offers = { data: baseOffer }
    state.tables.organizations = { data: { status: 'kyb_submitted', kyb_status: 'submitted' } }

    const res = await PATCH(patchRequest({ action: 'create_room' }), { params: Promise.resolve({ id: 'offer-1' }) })
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toMatch(/KYB-approved/i)
    expect(offerActionMocks.ensureRoom).not.toHaveBeenCalled()
  })

  it("allows action='create_room' from an admitted caller org", async () => {
    const { PATCH } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'offeror-org' } }
    state.tables.marketplace_offers = { data: baseOffer }
    state.tables.organizations = { data: { status: 'active', kyb_status: 'approved' } }

    const res = await PATCH(patchRequest({ action: 'create_room' }), { params: Promise.resolve({ id: 'offer-1' }) })
    expect(res.status).not.toBe(403)
  })

  for (const action of ['reject', 'withdraw'] as const) {
    it(`does not gate action='${action}' on admission — a non-admitted org may still decline`, async () => {
      const { PATCH } = await import('./route')

      state.currentUser = { id: 'user-1' }
      state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'offeror-org' } }
      state.tables.marketplace_offers = { data: baseOffer }
      // No 'organizations' table stub needed/consulted for these actions — if the
      // route incorrectly queried it, the default { data: null } response would
      // make isOrgAdmitted() false and these would wrongly 403.

      const res = await PATCH(patchRequest({ action }), { params: Promise.resolve({ id: 'offer-1' }) })
      expect(res.status).not.toBe(403)
    })
  }

  it('still enforces party membership before any admission check (unrelated org denied regardless of KYB status)', async () => {
    const { PATCH } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'some-other-org' } }
    state.tables.marketplace_offers = { data: baseOffer }
    state.tables.organizations = { data: { status: 'active', kyb_status: 'approved' } }

    const res = await PATCH(patchRequest({ action: 'accept' }), { params: Promise.resolve({ id: 'offer-1' }) })
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBe('Access denied')
  })
})
