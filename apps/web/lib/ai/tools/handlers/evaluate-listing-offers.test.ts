// Regression tests for PR 3: evaluate_listing_offers previously had NO
// ownership check and execute.ts didn't even pass it an actor — any
// authenticated org could evaluate offers (competitor pricing, every
// offeror's Passport/risk data) on ANY listing_id.
import { describe, expect, it, beforeEach, vi } from 'vitest'

interface TableResponse { data: unknown; error?: unknown }
const state: { tables: Record<string, TableResponse> } = { tables: {} }

function createChain(response: TableResponse) {
  const chain: Record<string, unknown> = {}
  const chainMethods = ['select', 'eq', 'in', 'not', 'order', 'single', 'maybeSingle']
  for (const method of chainMethods) {
    chain[method] = () => chain
  }
  ;(chain as { then: unknown }).then = (
    resolve?: (value: TableResponse) => void
  ) => { if (resolve) resolve(response) }
  return chain
}

vi.mock('../admin', () => ({
  adminClient: {
    from: (table: string) => createChain(state.tables[table] ?? { data: null, error: null }),
  },
}))

const baseListing = { id: 'listing-1', title: 'Widgets', listing_type: 'po_request', target_price: 1000, currency: 'USD', org_id: 'buyer-org' }

beforeEach(() => {
  state.tables = {}
})

describe('evaluateListingOffers() — ownership enforcement (PR 3)', () => {
  it('denies when no actor is supplied at all', async () => {
    const { evaluateListingOffers } = await import('./evaluate-listing-offers')
    const result = await evaluateListingOffers({ listing_id: 'listing-1' })
    expect(result.error).toMatch(/authenticated organization/i)
  })

  it('denies a direct call where actor.orgId does not own the listing — "actor/org mismatch is denied"', async () => {
    const { evaluateListingOffers } = await import('./evaluate-listing-offers')
    state.tables.marketplace_listings = { data: baseListing }

    const result = await evaluateListingOffers(
      { listing_id: 'listing-1' },
      { userId: 'user-1', orgId: 'some-other-org', bankId: null }
    )
    expect(result.error).toBe('Forbidden')
  })

  it('allows the listing owner and returns offer data', async () => {
    const { evaluateListingOffers } = await import('./evaluate-listing-offers')
    state.tables.marketplace_listings = { data: baseListing }
    state.tables.marketplace_offers = { data: [] }

    const result = await evaluateListingOffers(
      { listing_id: 'listing-1' },
      { userId: 'user-1', orgId: 'buyer-org', bankId: null }
    )
    expect(result.error).toBeUndefined()
    expect(result.message).toMatch(/no active offers/i)
  })
})
