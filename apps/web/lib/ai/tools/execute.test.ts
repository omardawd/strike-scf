// Regression tests for PR 1b/1-closure item 1: admission (and org identity in
// general) must be checked against the AUTHENTICATED actor.orgId, never an
// organization id supplied in tool_input — toolInput is model/prompt
// controlled, so a non-admitted actor could otherwise put an APPROVED org's
// id in the tool call and slip straight past the admission gate (or, more
// generally, impersonate any other org for the whole action, not just
// admission). dispatchTool() rejects any call where toolInput's org-id field
// doesn't match actor.orgId, and the admission check itself is keyed off
// actor.orgId exclusively.
import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { ToolName } from './execute'

interface TableResponse { data: unknown; error?: unknown }
const state: { tables: Record<string, TableResponse> } = { tables: {} }

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

// Handlers themselves are irrelevant to this test — we only need to prove the
// gate short-circuits BEFORE a handler is ever reached, so stub every handler
// module to something that would fail loudly if actually invoked.
const unreachable = () => { throw new Error('handler should not have been called — the gate should have short-circuited') }

vi.mock('./handlers/create-marketplace-listing', () => ({ createMarketplaceListing: unreachable }))
vi.mock('./handlers/submit-marketplace-offer', () => ({ submitMarketplaceOffer: unreachable }))
vi.mock('./handlers/create-financing-request', () => ({ createFinancingRequest: unreachable }))
vi.mock('./handlers/create-network', () => ({ createNetwork: unreachable }))
vi.mock('./handlers/add-network-member', () => ({ addNetworkMember: unreachable }))
vi.mock('./handlers/counter-marketplace-offer', () => ({ counterMarketplaceOffer: unreachable }))
vi.mock('./handlers/accept-marketplace-offer', () => ({ acceptMarketplaceOffer: unreachable }))
vi.mock('./handlers/reject-marketplace-offer', () => ({ rejectMarketplaceOffer: unreachable }))
// Every other handler import in execute.ts just needs to resolve — stub minimally.
vi.mock('./handlers/evaluate-supplier-passport', () => ({ evaluateSupplierPassport: unreachable }))
vi.mock('./handlers/find-and-recommend-deals', () => ({ findAndRecommendDeals: unreachable }))
vi.mock('./handlers/get-pricing-insights', () => ({ getPricingInsights: unreachable }))
vi.mock('./handlers/summarize-deal-negotiation', () => ({ summarizeDealNegotiation: unreachable }))
vi.mock('./handlers/score-and-rank-financing-offers', () => ({ scoreAndRankFinancingOffers: unreachable }))
vi.mock('./handlers/detect-deal-risk-signals', () => ({ detectDealRiskSignals: unreachable }))
vi.mock('./handlers/recommend-suppliers-for-buyer', () => ({ recommendSuppliersForBuyer: unreachable }))
vi.mock('./handlers/generate-deal-term-sheet', () => ({ generateDealTermSheet: unreachable }))
vi.mock('./handlers/proactive-portfolio-alerts', () => ({ proactivePortfolioAlerts: unreachable }))
vi.mock('./handlers/lookup-entities', () => ({ lookupEntities: unreachable }))
vi.mock('./handlers/evaluate-listing-offers', () => ({ evaluateListingOffers: unreachable }))
vi.mock('./handlers/get-passport-advice', () => ({ getPassportAdvice: unreachable }))
vi.mock('./handlers/get-active-deals', () => ({ getActiveDeals: unreachable }))
vi.mock('./handlers/search-marketplace-listings', () => ({ searchMarketplaceListings: unreachable }))
vi.mock('./handlers/search-web', () => ({ handleSearchWeb: unreachable }))
vi.mock('./handlers/get-financing-programs', () => ({ getFinancingPrograms: unreachable }))
vi.mock('./handlers/get-erp-data', () => ({ getErpData: unreachable }))
vi.mock('./handlers/get-capital-position', () => ({ getCapitalPosition: unreachable }))
vi.mock('./handlers/get-agent-tasks', () => ({ getAgentTasks: unreachable }))
vi.mock('./handlers/generate-document', () => ({ generateDocument: unreachable }))
vi.mock('./handlers/deal-workflow', () => ({ getDealWorkflow: unreachable, proposeDealWorkflowStep: unreachable }))
vi.mock('../demo-ai-cache', () => ({ getCachedAiResponse: async () => null, setCachedAiResponse: () => {} }))

beforeEach(() => {
  state.tables = {}
})

// Tools that require ADMISSION (a subset of TOOL_ORG_ID_FIELDS — reject is
// actor-bound but not admission-gated, so it's tested separately below).
const admissionGatedCases: Array<{ tool: ToolName; orgKey: string }> = [
  { tool: 'create_marketplace_listing', orgKey: 'org_id' },
  { tool: 'submit_marketplace_offer', orgKey: 'from_org_id' },
  { tool: 'create_financing_request', orgKey: 'org_id' },
  { tool: 'create_network', orgKey: 'org_id' },
  { tool: 'add_network_member', orgKey: 'org_id' },
]

describe('executeTool() — actor-bound org identity (closure item 1)', () => {
  for (const { tool, orgKey } of admissionGatedCases) {
    it(`'${tool}': rejects when no actor is supplied at all, even with a claimed org id in toolInput`, async () => {
      const { executeTool } = await import('./execute')

      const result = await executeTool(tool, { [orgKey]: 'org-1' })
      expect(result.error).toMatch(/authenticated organization/i)
    })

    it(`'${tool}': a NON-ADMITTED actor cannot use an APPROVED org's id in tool_input to bypass admission`, async () => {
      const { executeTool } = await import('./execute')

      // The actor is really 'actor-org' (non-admitted). toolInput claims to
      // be acting as 'approved-org' instead — the org id fields agree with
      // each other being different from the actor, simulating a model (or
      // injected prompt) trying to borrow an approved org's identity.
      state.tables.organizations = { data: { status: 'active', kyb_status: 'approved' } } // would pass admission if trusted
      const result = await executeTool(
        tool,
        { [orgKey]: 'approved-org' },
        { actor: { userId: 'user-1', orgId: 'actor-org', bankId: null } }
      )
      expect(result.error).toMatch(/organization mismatch/i)
      expect(result.error).not.toMatch(/KYB-approved/i)
    })

    it(`'${tool}': denies the actor's own org when it is non-admitted (toolInput org id matches actor)`, async () => {
      const { executeTool } = await import('./execute')

      state.tables.organizations = { data: { status: 'kyb_submitted', kyb_status: 'submitted' } }
      const result = await executeTool(
        tool,
        { [orgKey]: 'actor-org' },
        { actor: { userId: 'user-1', orgId: 'actor-org', bankId: null } }
      )
      expect(result.error).toMatch(/KYB-approved/i)
    })

    it(`'${tool}': does not block an admitted actor acting as their own org (fails later, inside the stubbed handler)`, async () => {
      const { executeTool } = await import('./execute')

      state.tables.organizations = { data: { status: 'active', kyb_status: 'approved' } }
      await expect(
        executeTool(tool, { [orgKey]: 'actor-org' }, { actor: { userId: 'user-1', orgId: 'actor-org', bankId: null } })
      ).rejects.toThrow(/handler should not have been called/)
    })

    it(`'${tool}': is not gated at all when toolInput omits the org id field (nothing to validate against)`, async () => {
      const { executeTool } = await import('./execute')

      // No actor, no claimed org id — the mismatch check has nothing to
      // compare, but the admission check still requires a real actor.orgId.
      const result = await executeTool(tool, {})
      expect(result.error).toMatch(/authenticated organization/i)
    })
  }

  it("'reject_marketplace_offer' is actor-bound (org id must match) but NOT admission-gated", async () => {
    const { executeTool } = await import('./execute')

    // Mismatch is still rejected even though reject never checks admission.
    const mismatch = await executeTool(
      'reject_marketplace_offer',
      { acting_org_id: 'some-other-org' },
      { actor: { userId: 'user-1', orgId: 'actor-org', bankId: null } }
    )
    expect(mismatch.error).toMatch(/organization mismatch/i)

    // No 'organizations' stub — if this were (wrongly) admission-gated it
    // would resolve with a KYB-approved error instead of reaching the
    // stubbed handler.
    await expect(
      executeTool('reject_marketplace_offer', { acting_org_id: 'actor-org' }, { actor: { userId: 'user-1', orgId: 'actor-org', bankId: null } })
    ).rejects.toThrow(/handler should not have been called/)
  })

  it("'counter_marketplace_offer'/'accept_marketplace_offer' reject an org-id mismatch before ever reaching offer-actions.ts", async () => {
    const { executeTool } = await import('./execute')

    for (const tool of ['counter_marketplace_offer', 'accept_marketplace_offer'] as const) {
      const result = await executeTool(
        tool,
        { acting_org_id: 'some-other-org' },
        { actor: { userId: 'user-1', orgId: 'actor-org', bankId: null } }
      )
      expect(result.error).toMatch(/organization mismatch/i)
    }
  })

  it('does not gate a read-only tool (lookup_entities) on admission or actor identity at all', async () => {
    const { executeTool } = await import('./execute')

    // No 'organizations' stub, no actor — if this were (wrongly) gated it
    // would resolve with an error instead of reaching the stubbed handler.
    await expect(executeTool('lookup_entities', { org_id: 'org-1' })).rejects.toThrow(
      /handler should not have been called/
    )
  })
})
