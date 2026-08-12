// Regression tests for PR 3: recommendAward() must never accept an offer
// itself, and must refuse to create a recommendation that's already invalid
// (wrong owner, wrong listing type, cross-listing offer, non-actionable
// offer, non-admitted supplier).
import { describe, expect, it, beforeEach, vi } from 'vitest'

interface TableResponse { data: unknown; error?: unknown }
const state: { tables: Record<string, TableResponse> } = { tables: {} }
const insertedTasks: Record<string, unknown>[] = []

function createChain(table: string, response: TableResponse) {
  const chain: Record<string, unknown> = {}
  const chainMethods = ['select', 'eq', 'in', 'not', 'order', 'single', 'maybeSingle']
  for (const method of chainMethods) {
    chain[method] = () => chain
  }
  chain.insert = (payload: Record<string, unknown>) => {
    if (table === 'agent_tasks') insertedTasks.push(payload)
    return {
      select: () => ({
        single: async () => ({ data: { id: 'task-1', ...payload }, error: null }),
      }),
    }
  }
  ;(chain as { then: unknown }).then = (
    resolve?: (value: TableResponse) => void
  ) => { if (resolve) resolve(response) }
  return chain
}

vi.mock('../admin', () => ({
  adminClient: {
    from: (table: string) => createChain(table, state.tables[table] ?? { data: null, error: null }),
  },
}))

vi.mock('@/lib/audit/log', () => ({ writeAuditEvent: async () => {} }))

const poRequestListing = { id: 'listing-1', org_id: 'buyer-org', listing_type: 'po_request', title: 'Widgets sourcing' }
const productListing = { ...poRequestListing, listing_type: 'product_service' }
const actionableOffer = { id: 'offer-1', listing_id: 'listing-1', from_org_id: 'supplier-org', status: 'pending', offered_price: 1000, current_round: 1 }
const admittedOrg = { status: 'active', kyb_status: 'approved' }

const actor = { userId: 'user-1', orgId: 'buyer-org', bankId: null }

beforeEach(() => {
  state.tables = {}
  insertedTasks.length = 0
})

describe('recommendAward() — server validation (PR 3)', () => {
  it('denies when no actor is supplied', async () => {
    const { recommendAward } = await import('./recommend-award')
    const result = await recommendAward({ listing_id: 'listing-1', offer_id: 'offer-1', rationale: 'best price' })
    expect(result.error).toMatch(/authenticated organization/i)
  })

  it('denies a non-owner (actor/org mismatch)', async () => {
    const { recommendAward } = await import('./recommend-award')
    state.tables.marketplace_listings = { data: poRequestListing }

    const result = await recommendAward(
      { listing_id: 'listing-1', offer_id: 'offer-1', rationale: 'best price' },
      { userId: 'user-1', orgId: 'some-other-org', bankId: null }
    )
    expect(result.error).toMatch(/forbidden/i)
    expect(insertedTasks).toHaveLength(0)
  })

  it('rejects a non-po_request listing', async () => {
    const { recommendAward } = await import('./recommend-award')
    state.tables.marketplace_listings = { data: productListing }

    const result = await recommendAward({ listing_id: 'listing-1', offer_id: 'offer-1', rationale: 'best price' }, actor)
    expect(result.error).toMatch(/po_request/i)
    expect(insertedTasks).toHaveLength(0)
  })

  it('rejects an offer belonging to a different listing', async () => {
    const { recommendAward } = await import('./recommend-award')
    state.tables.marketplace_listings = { data: poRequestListing }
    state.tables.marketplace_offers = { data: { ...actionableOffer, listing_id: 'some-other-listing' } }

    const result = await recommendAward({ listing_id: 'listing-1', offer_id: 'offer-1', rationale: 'best price' }, actor)
    expect(result.error).toMatch(/does not belong to the specified listing/i)
    expect(insertedTasks).toHaveLength(0)
  })

  it('rejects a non-actionable (already accepted/withdrawn/rejected) offer', async () => {
    const { recommendAward } = await import('./recommend-award')
    state.tables.marketplace_listings = { data: poRequestListing }
    state.tables.marketplace_offers = { data: { ...actionableOffer, status: 'withdrawn' } }

    const result = await recommendAward({ listing_id: 'listing-1', offer_id: 'offer-1', rationale: 'best price' }, actor)
    expect(result.error).toMatch(/not currently actionable/i)
    expect(insertedTasks).toHaveLength(0)
  })

  it('rejects a non-admitted (suspended) supplier', async () => {
    const { recommendAward } = await import('./recommend-award')
    state.tables.marketplace_listings = { data: poRequestListing }
    state.tables.marketplace_offers = { data: actionableOffer }
    state.tables.organizations = { data: { status: 'suspended', kyb_status: 'approved' } }

    const result = await recommendAward({ listing_id: 'listing-1', offer_id: 'offer-1', rationale: 'best price' }, actor)
    expect(result.error).toMatch(/not currently admitted/i)
    expect(insertedTasks).toHaveLength(0)
  })

  it('creates an award_recommendation task with proposed_action pointing at accept_marketplace_offer, and never accepts anything itself', async () => {
    const { recommendAward } = await import('./recommend-award')
    state.tables.marketplace_listings = { data: poRequestListing }
    state.tables.marketplace_offers = { data: actionableOffer }
    state.tables.organizations = { data: admittedOrg }

    const result = await recommendAward({ listing_id: 'listing-1', offer_id: 'offer-1', rationale: 'best price', risks: 'none material' }, actor)
    expect(result.error).toBeUndefined()
    expect(result.task_id).toBe('task-1')
    expect(insertedTasks).toHaveLength(1)

    const task = insertedTasks[0] as Record<string, unknown>
    expect(task.type).toBe('award_recommendation')
    expect(task.status).toBe('awaiting_approval')
    const proposedAction = task.proposed_action as { tool_name: string; tool_input: Record<string, unknown> }
    expect(proposedAction.tool_name).toBe('accept_marketplace_offer')
    expect(proposedAction.tool_input.offer_id).toBe('offer-1')
    expect(proposedAction.tool_input.acting_org_id).toBe('buyer-org')

    const plan = task.plan as Record<string, unknown>
    expect(plan.snapshot_round).toBe(1)
  })
})
