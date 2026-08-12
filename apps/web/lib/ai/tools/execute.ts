// Central dispatcher for all Strike AI tools.
// Called by /api/ai/tools/execute after auth and scoping checks.
// Each handler owns its own adminClient (imported from ../admin) to avoid type parameter issues.

import { createMarketplaceListing, type CreateMarketplaceListingInput } from './handlers/create-marketplace-listing'
import { evaluateSupplierPassport, type EvaluateSupplierPassportInput } from './handlers/evaluate-supplier-passport'
import { findAndRecommendDeals, type FindAndRecommendDealsInput } from './handlers/find-and-recommend-deals'
import { getPricingInsights, type GetPricingInsightsInput } from './handlers/get-pricing-insights'
import { summarizeDealNegotiation, type SummarizeDealNegotiationInput } from './handlers/summarize-deal-negotiation'
import { scoreAndRankFinancingOffers, type ScoreAndRankFinancingOffersInput } from './handlers/score-and-rank-financing-offers'
import { detectDealRiskSignals, type DetectDealRiskSignalsInput } from './handlers/detect-deal-risk-signals'
import { recommendSuppliersForBuyer, type RecommendSuppliersForBuyerInput } from './handlers/recommend-suppliers-for-buyer'
import { generateDealTermSheet, type GenerateDealTermSheetInput } from './handlers/generate-deal-term-sheet'
import { proactivePortfolioAlerts, type ProactivePortfolioAlertsInput } from './handlers/proactive-portfolio-alerts'
import { lookupEntities, type LookupEntitiesInput } from './handlers/lookup-entities'
import { evaluateListingOffers, type EvaluateListingOffersInput } from './handlers/evaluate-listing-offers'
import { getPassportAdvice, type GetPassportAdviceInput } from './handlers/get-passport-advice'
import { getActiveDeals, type GetActiveDealsInput } from './handlers/get-active-deals'
import { searchMarketplaceListings, type SearchMarketplaceListingsInput } from './handlers/search-marketplace-listings'
import { submitMarketplaceOffer, type SubmitMarketplaceOfferInput } from './handlers/submit-marketplace-offer'
import { handleSearchWeb } from './handlers/search-web'
import { getFinancingPrograms, type GetFinancingProgramsInput } from './handlers/get-financing-programs'
import { getErpData, type GetErpDataInput } from './handlers/get-erp-data'
import { getCapitalPosition, type GetCapitalPositionInput } from './handlers/get-capital-position'
import { createFinancingRequest } from './handlers/create-financing-request'
import { createNetwork, type CreateNetworkInput } from './handlers/create-network'
import { addNetworkMember, type AddNetworkMemberInput } from './handlers/add-network-member'
import { getAgentTasks, type GetAgentTasksInput } from './handlers/get-agent-tasks'
import { counterMarketplaceOffer, type CounterMarketplaceOfferInput } from './handlers/counter-marketplace-offer'
import { acceptMarketplaceOffer, type AcceptMarketplaceOfferInput } from './handlers/accept-marketplace-offer'
import { rejectMarketplaceOffer, type RejectMarketplaceOfferInput } from './handlers/reject-marketplace-offer'
import { generateDocument, type GenerateDocumentInput } from './handlers/generate-document'
import { getDealWorkflow, proposeDealWorkflowStep, type ProposeDealWorkflowStepInput, type ToolActor } from './handlers/deal-workflow'
import { findEligibleSuppliers, type FindEligibleSuppliersInput } from './handlers/find-eligible-suppliers'
import { draftSourcingRequest, type DraftSourcingRequestInput } from './handlers/draft-sourcing-request'
import { draftSupplierOutreach, type DraftSupplierOutreachInput } from './handlers/draft-supplier-outreach'
import { recommendAward, type RecommendAwardInput } from './handlers/recommend-award'
import { requestSourcingSearch, type RequestSourcingSearchInput } from './handlers/request-sourcing-search'
import { getSourcingSearchStatus, type GetSourcingSearchStatusInput } from './handlers/get-sourcing-search-status'
import { getBoard, designBoardWorkflow, createBoardTask, assignBoardTask, moveBoardTask, type GetBoardInput, type DesignBoardWorkflowInput, type CreateBoardTaskInput, type AssignBoardTaskInput, type MoveBoardTaskInput } from './handlers/board'
import { getCachedAiResponse, setCachedAiResponse } from '../demo-ai-cache'
import { adminClient } from './admin'
import { isOrgAdmitted } from '@/lib/auth/admission'

export type ToolName =
  | 'get_agent_tasks'
  | 'create_financing_request'
  | 'create_marketplace_listing'
  | 'create_network'
  | 'add_network_member'
  | 'counter_marketplace_offer'
  | 'accept_marketplace_offer'
  | 'reject_marketplace_offer'
  | 'evaluate_supplier_passport'
  | 'find_and_recommend_deals'
  | 'get_pricing_insights'
  | 'summarize_deal_negotiation'
  | 'score_and_rank_financing_offers'
  | 'detect_deal_risk_signals'
  | 'recommend_suppliers_for_buyer'
  | 'generate_deal_term_sheet'
  | 'proactive_portfolio_alerts'
  | 'lookup_entities'
  | 'evaluate_listing_offers'
  | 'get_passport_advice'
  | 'get_active_deals'
  | 'search_marketplace_listings'
  | 'submit_marketplace_offer'
  | 'search_web'
  | 'get_financing_programs'
  | 'get_erp_data'
  | 'get_capital_position'
  | 'generate_document'
  | 'get_deal_workflow'
  | 'propose_deal_workflow_step'
  | 'find_eligible_suppliers'
  | 'draft_sourcing_request'
  | 'draft_supplier_outreach'
  | 'recommend_award'
  | 'request_sourcing_search'
  | 'get_sourcing_search_status'
  | 'get_board'
  | 'design_board_workflow'
  | 'create_board_task'
  | 'assign_board_task'
  | 'move_board_task'

// Stable (key-sorted) stringify so the same logical tool input always
// produces the same cache key regardless of property insertion order.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

export async function executeTool(
  toolName: ToolName,
  toolInput: Record<string, unknown>,
  // Set by demo-tour-only callers (see lib/ai/demo-ai-cache.ts) that already
  // know they're inside the scripted demo tenant flow. Read-only/reasoning
  // tools (anything not in WRITE_TOOLS) get their result cached and replayed
  // on later tour runs instead of re-spending real API credits and DB reads
  // — WRITE_TOOLS are always excluded here regardless of this flag, since
  // those need to create fresh real state (offers, negotiations, deals)
  // every single replay.
  opts?: { demoCacheable?: boolean; actor?: ToolActor }
): Promise<Record<string, unknown>> {
  if (opts?.demoCacheable && !WRITE_TOOLS.includes(toolName)) {
    const cacheKey = `tool:${toolName}:${stableStringify(toolInput)}`
    const cached = await getCachedAiResponse(cacheKey)
    if (cached) return cached as Record<string, unknown>
    const result = await dispatchTool(toolName, toolInput, opts.actor)
    setCachedAiResponse(cacheKey, result)
    return result
  }
  return dispatchTool(toolName, toolInput, opts?.actor)
}

// Tool name -> the key in toolInput holding the ACTING org id, for every write
// tool that identifies which org is performing the action. These handlers
// (lib/ai/tools/handlers/*) write directly via their own adminClient — they
// do NOT go through the HTTP routes in app/api/marketplace/**, so route-level
// admission checks never applied to Strike AI chat, /api/ai/dispatch, or the
// autonomous tick loop. This is the one place all of them funnel through.
//
// SECURITY: toolInput is model/prompt-controlled — an LLM can be prompted
// (deliberately or via injection) to put ANY org id in these fields. It must
// never be trusted as the caller's real identity. `actor.orgId` — set by the
// caller (route/tick loop) from an authenticated session or a validated DB
// row, never from tool_input — is the only trustworthy source of "who is
// actually calling this." assertActorOwnsToolOrg() below rejects any call
// where the org id claimed in toolInput doesn't match actor.orgId, and the
// admission check itself is keyed off actor.orgId, never toolInput.
const TOOL_ORG_ID_FIELDS: Partial<Record<ToolName, string>> = {
  create_marketplace_listing: 'org_id',
  submit_marketplace_offer: 'from_org_id',
  create_financing_request: 'org_id',
  create_network: 'org_id',
  add_network_member: 'org_id',
  counter_marketplace_offer: 'acting_org_id',
  accept_marketplace_offer: 'acting_org_id',
  reject_marketplace_offer: 'acting_org_id',
  // Not admission-gated (see ADMISSION_GATED_TOOLS below) — searching isn't a
  // commercial commitment, but the job
  // row it creates must still be bound to the actor's own org.
  request_sourcing_search: 'org_id',
}

// Subset of TOOL_ORG_ID_FIELDS that additionally requires the acting org to
// be admitted (approved + active). reject/withdraw stay exempt everywhere —
// declining never needs approval. counter/accept are admission-checked
// inside counterOffer()/acceptOffer() themselves (lib/marketplace/
// offer-actions.ts), which these handlers call — not duplicated here.
const ADMISSION_GATED_TOOLS: ReadonlySet<ToolName> = new Set([
  'create_marketplace_listing',
  'submit_marketplace_offer',
  'create_financing_request',
  'create_network',
  'add_network_member',
])

/**
 * Rejects any write tool call where toolInput claims an org id that isn't
 * the authenticated actor's own — a non-admitted actor cannot use an
 * approved org's id to slip past admission (or, more generally, impersonate
 * any other org) by simply putting a different id in the tool call.
 */
function assertActorOwnsToolOrg(
  toolName: ToolName,
  toolInput: Record<string, unknown>,
  actor?: ToolActor
): string | null {
  const orgIdKey = TOOL_ORG_ID_FIELDS[toolName]
  if (!orgIdKey) return null
  const claimedOrgId = toolInput[orgIdKey]
  if (typeof claimedOrgId !== 'string' || !claimedOrgId) return null
  if (!actor?.orgId) {
    return 'An authenticated organization is required to do this'
  }
  if (claimedOrgId !== actor.orgId) {
    return 'Organization mismatch: this action can only be performed as your own organization'
  }
  return null
}

async function assertToolCallerAdmitted(
  toolName: ToolName,
  actor?: ToolActor
): Promise<string | null> {
  if (!ADMISSION_GATED_TOOLS.has(toolName)) return null
  if (!actor?.orgId) {
    return 'An authenticated organization is required to do this'
  }
  const { data: org } = await adminClient
    .from('organizations')
    .select('status, kyb_status')
    .eq('id', actor.orgId)
    .single()
  if (!isOrgAdmitted(org)) {
    return 'Organization must be KYB-approved to do this'
  }
  return null
}

async function dispatchTool(
  toolName: ToolName,
  toolInput: Record<string, unknown>,
  actor?: ToolActor
): Promise<Record<string, unknown>> {
  const mismatchError = assertActorOwnsToolOrg(toolName, toolInput, actor)
  if (mismatchError) return { error: mismatchError }

  const admissionError = await assertToolCallerAdmitted(toolName, actor)
  if (admissionError) return { error: admissionError }

  switch (toolName) {
    case 'get_agent_tasks':
      return getAgentTasks(toolInput as unknown as GetAgentTasksInput)
    case 'create_financing_request':
      return createFinancingRequest(toolInput as unknown as Parameters<typeof createFinancingRequest>[0])
    case 'create_marketplace_listing':
      return createMarketplaceListing(toolInput as unknown as CreateMarketplaceListingInput)
    case 'create_network':
      return createNetwork(toolInput as unknown as CreateNetworkInput)
    case 'add_network_member':
      return addNetworkMember(toolInput as unknown as AddNetworkMemberInput)
    case 'evaluate_supplier_passport':
      return evaluateSupplierPassport(toolInput as unknown as EvaluateSupplierPassportInput)
    case 'find_and_recommend_deals':
      return findAndRecommendDeals(toolInput as unknown as FindAndRecommendDealsInput)
    case 'get_pricing_insights':
      return getPricingInsights(toolInput as unknown as GetPricingInsightsInput)
    case 'summarize_deal_negotiation':
      return summarizeDealNegotiation(toolInput as unknown as SummarizeDealNegotiationInput)
    case 'score_and_rank_financing_offers':
      return scoreAndRankFinancingOffers(toolInput as unknown as ScoreAndRankFinancingOffersInput)
    case 'detect_deal_risk_signals':
      return detectDealRiskSignals(toolInput as unknown as DetectDealRiskSignalsInput)
    case 'recommend_suppliers_for_buyer':
      return recommendSuppliersForBuyer(toolInput as unknown as RecommendSuppliersForBuyerInput)
    case 'generate_deal_term_sheet':
      return generateDealTermSheet(toolInput as unknown as GenerateDealTermSheetInput)
    case 'proactive_portfolio_alerts':
      return proactivePortfolioAlerts(toolInput as unknown as ProactivePortfolioAlertsInput)
    case 'lookup_entities':
      return lookupEntities(toolInput as unknown as LookupEntitiesInput)
    case 'evaluate_listing_offers':
      return evaluateListingOffers(toolInput as unknown as EvaluateListingOffersInput, actor)
    case 'get_passport_advice':
      return getPassportAdvice(toolInput as unknown as GetPassportAdviceInput)
    case 'get_active_deals':
      return getActiveDeals(toolInput as unknown as GetActiveDealsInput)
    case 'search_marketplace_listings':
      return searchMarketplaceListings(toolInput as unknown as SearchMarketplaceListingsInput)
    case 'submit_marketplace_offer':
      return submitMarketplaceOffer(toolInput as unknown as SubmitMarketplaceOfferInput)
    case 'counter_marketplace_offer':
      return counterMarketplaceOffer(toolInput as unknown as CounterMarketplaceOfferInput)
    case 'accept_marketplace_offer':
      return acceptMarketplaceOffer(toolInput as unknown as AcceptMarketplaceOfferInput)
    case 'reject_marketplace_offer':
      return rejectMarketplaceOffer(toolInput as unknown as RejectMarketplaceOfferInput)
    case 'search_web':
      return handleSearchWeb(toolInput)
    case 'get_financing_programs':
      return getFinancingPrograms(toolInput as unknown as GetFinancingProgramsInput)
    case 'get_erp_data':
      return getErpData(toolInput as unknown as GetErpDataInput)
    case 'get_capital_position':
      return getCapitalPosition(toolInput as unknown as GetCapitalPositionInput)
    case 'generate_document':
      return generateDocument(toolInput as unknown as GenerateDocumentInput)
    case 'get_deal_workflow':
      return getDealWorkflow(toolInput as unknown as { deal_id: string }, actor)
    case 'propose_deal_workflow_step':
      return proposeDealWorkflowStep(toolInput as unknown as ProposeDealWorkflowStepInput, actor)
    case 'find_eligible_suppliers':
      return findEligibleSuppliers(toolInput as unknown as FindEligibleSuppliersInput, actor)
    case 'draft_sourcing_request':
      return draftSourcingRequest(toolInput as unknown as DraftSourcingRequestInput)
    case 'draft_supplier_outreach':
      return draftSupplierOutreach(toolInput as unknown as DraftSupplierOutreachInput, actor)
    case 'recommend_award':
      return recommendAward(toolInput as unknown as RecommendAwardInput, actor)
    case 'request_sourcing_search':
      return requestSourcingSearch(toolInput as unknown as RequestSourcingSearchInput, actor)
    case 'get_sourcing_search_status':
      return getSourcingSearchStatus(toolInput as unknown as GetSourcingSearchStatusInput, actor)
    case 'get_board':
      return getBoard(toolInput as unknown as GetBoardInput, actor)
    case 'design_board_workflow':
      return designBoardWorkflow(toolInput as unknown as DesignBoardWorkflowInput, actor)
    case 'create_board_task':
      return createBoardTask(toolInput as unknown as CreateBoardTaskInput, actor)
    case 'assign_board_task':
      return assignBoardTask(toolInput as unknown as AssignBoardTaskInput, actor)
    case 'move_board_task':
      return moveBoardTask(toolInput as unknown as MoveBoardTaskInput, actor)
    default:
      return { error: `Unknown tool: ${toolName as string}` }
  }
}

// Tools that require a bank user
export const BANK_ONLY_TOOLS: ToolName[] = ['proactive_portfolio_alerts']

// Tools that write to the database (subject to agent approval preference)
export const WRITE_TOOLS: ToolName[] = [
  'create_financing_request',
  'create_marketplace_listing',
  'create_network',
  'add_network_member',
  'score_and_rank_financing_offers',
  'submit_marketplace_offer',
  'counter_marketplace_offer',
  'accept_marketplace_offer',
  'reject_marketplace_offer',
  'propose_deal_workflow_step',
  'request_sourcing_search',
  'design_board_workflow',
  'create_board_task',
  'assign_board_task',
  'move_board_task',
]
