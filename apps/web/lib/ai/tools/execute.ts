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
import { getAgentTasks, type GetAgentTasksInput } from './handlers/get-agent-tasks'
import { counterMarketplaceOffer, type CounterMarketplaceOfferInput } from './handlers/counter-marketplace-offer'
import { acceptMarketplaceOffer, type AcceptMarketplaceOfferInput } from './handlers/accept-marketplace-offer'
import { rejectMarketplaceOffer, type RejectMarketplaceOfferInput } from './handlers/reject-marketplace-offer'

export type ToolName =
  | 'get_agent_tasks'
  | 'create_financing_request'
  | 'create_marketplace_listing'
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

export async function executeTool(
  toolName: ToolName,
  toolInput: Record<string, unknown>
): Promise<Record<string, unknown>> {
  switch (toolName) {
    case 'get_agent_tasks':
      return getAgentTasks(toolInput as unknown as GetAgentTasksInput)
    case 'create_financing_request':
      return createFinancingRequest(toolInput as unknown as Parameters<typeof createFinancingRequest>[0])
    case 'create_marketplace_listing':
      return createMarketplaceListing(toolInput as unknown as CreateMarketplaceListingInput)
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
      return evaluateListingOffers(toolInput as unknown as EvaluateListingOffersInput)
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
  'score_and_rank_financing_offers',
  'submit_marketplace_offer',
  'counter_marketplace_offer',
  'accept_marketplace_offer',
  'reject_marketplace_offer',
]
