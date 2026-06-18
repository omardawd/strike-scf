// Strike AI tool definitions — passed to the Anthropic API.
// Execution lives in execute.ts / handlers/.
//
// Token discipline: keep descriptions short. The system prompt already tells
// Claude to call lookup_entities when it only has a name — no need to repeat
// that instruction in every tool description.

const LOOKUP_ENTITIES = {
  name: 'lookup_entities',
  description: 'Resolve a name or keyword to platform UUIDs (org, deal, financing_request). Call this first whenever the user refers to a counterparty or entity by name rather than UUID. Use query:"all" to list recent records.',
  input_schema: {
    type: 'object',
    properties: {
      entity_type: { type: 'string', enum: ['organization', 'deal', 'financing_request'] },
      query: { type: 'string', description: 'Name/keyword to search, or "all" for recent records' },
      org_id: { type: 'string', description: 'Scope deal/financing_request search to this org' },
      limit: { type: 'number', default: 5 },
    },
    required: ['entity_type', 'query'],
  },
}

const CREATE_MARKETPLACE_LISTING = {
  name: 'create_marketplace_listing',
  description: 'Create a marketplace listing (product/service or PO request) with line items. ALWAYS ask about incoterms and payment terms before calling if not provided. After success, respond with [LISTING_CARD:{listing_id}] on its own line.',
  input_schema: {
    type: 'object',
    properties: {
      org_id: { type: 'string' },
      listing_type: { type: 'string', enum: ['po_request', 'product_service'] },
      title: { type: 'string' },
      description: { type: 'string' },
      category: { type: 'string' },
      currency: { type: 'string', default: 'USD' },
      delivery_deadline: { type: 'string', format: 'date', description: 'YYYY-MM-DD. Always use the current year unless user specifies otherwise.' },
      delivery_location: { type: 'string' },
      incoterms: { type: 'string', description: 'e.g. CIF, FOB, EXW, DDP — always ask if not provided' },
      payment_terms: { type: 'string', description: 'e.g. Net 30, LC at sight, CAD — always ask if not provided' },
      expires_at: { type: 'string', format: 'date-time' },
      min_passport_score: { type: 'number', description: 'Minimum PassportScore to submit an offer (0–100)' },
      tags: { type: 'array', items: { type: 'string' } },
      visibility: { type: 'string', enum: ['public', 'network_only'], default: 'public' },
      network_id: { type: 'string', description: 'Required if visibility=network_only' },
      line_items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            quantity: { type: 'number' },
            unit: { type: 'string', default: 'units' },
            unit_price: { type: 'number' },
            specs: { type: 'object' },
            specs_flexible: { type: 'boolean', default: false },
          },
          required: ['name'],
        },
      },
    },
    required: ['org_id', 'listing_type', 'title', 'line_items'],
  },
}

const GET_ACTIVE_DEALS = {
  name: 'get_active_deals',
  description: 'List all active (non-completed, non-cancelled) deals for an org. Use when the user asks about current deals, deal status, or payment due dates.',
  input_schema: {
    type: 'object',
    properties: {
      org_id: { type: 'string' },
      status_filter: {
        type: 'string',
        enum: ['all', 'active_only', 'payment_due', 'needs_action'],
        default: 'all',
      },
    },
    required: ['org_id'],
  },
}

const EVALUATE_SUPPLIER_PASSPORT = {
  name: 'evaluate_supplier_passport',
  description: 'Evaluate an org\'s trust score using all platform data: KYB, financials, deals, peer reviews, performance, risk flags. Writes the PassportScore back to the org.',
  input_schema: {
    type: 'object',
    properties: {
      supplier_org_id: { type: 'string' },
      requesting_org_id: { type: 'string' },
      evaluation_purpose: {
        type: 'string',
        enum: ['deal_approval', 'financing_decision', 'partnership_vetting', 'network_onboarding', 'general'],
      },
      include_sections: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['business_profile', 'kyb_compliance', 'financial_health', 'platform_history', 'peer_reviews', 'performance_metrics', 'risk_flags', 'financing_behavior', 'supply_chain_footprint'],
        },
      },
    },
    required: ['supplier_org_id', 'evaluation_purpose'],
  },
}

const FIND_AND_RECOMMEND_DEALS = {
  name: 'find_and_recommend_deals',
  description: 'Match and score a potential deal between a specific buyer and supplier. Returns a scored recommendation with suggested deal terms.',
  input_schema: {
    type: 'object',
    properties: {
      buyer_org_id: { type: 'string' },
      supplier_org_id: { type: 'string' },
      deal_parameters: {
        type: 'object',
        properties: {
          product_category: { type: 'string' },
          total_deal_value: { type: 'number' },
          currency: { type: 'string', default: 'USD' },
          required_delivery_date: { type: 'string', format: 'date' },
          delivery_location: { type: 'string' },
          payment_terms_days: { type: 'number' },
        },
      },
      look_back_months: { type: 'number', default: 12 },
    },
    required: ['buyer_org_id', 'supplier_org_id'],
  },
}

const GET_PRICING_INSIGHTS = {
  name: 'get_pricing_insights',
  description: 'Benchmark a product price against internal platform data and live market indices (LME, CME, FAO). Returns market trends and negotiation guidance.',
  input_schema: {
    type: 'object',
    properties: {
      product_name: { type: 'string' },
      product_category: { type: 'string' },
      quantity: { type: 'number' },
      unit: { type: 'string', default: 'units' },
      proposed_unit_price: { type: 'number' },
      currency: { type: 'string', default: 'USD' },
      delivery_location: { type: 'string' },
      look_back_months: { type: 'number', default: 6 },
    },
    required: ['product_name'],
  },
}

const SUMMARIZE_DEAL_NEGOTIATION = {
  name: 'summarize_deal_negotiation',
  description: 'Summarize a deal\'s full negotiation history: events, amendments, room messages, open issues, and suggested next steps.',
  input_schema: {
    type: 'object',
    properties: {
      deal_id: { type: 'string' },
      include_room_messages: { type: 'boolean', default: true },
      max_messages: { type: 'number', default: 100 },
    },
    required: ['deal_id'],
  },
}

const SCORE_AND_RANK_FINANCING_OFFERS = {
  name: 'score_and_rank_financing_offers',
  description: 'Score and rank all bank offers on a financing request by rate, amount, tenor, and bank reputation. Writes ai_score back to each offer.',
  input_schema: {
    type: 'object',
    properties: {
      financing_request_id: { type: 'string' },
      priority: { type: 'string', enum: ['lowest_cost', 'fastest_funding', 'most_flexible', 'balanced'] },
      requesting_org_id: { type: 'string' },
    },
    required: ['financing_request_id', 'priority'],
  },
}

const DETECT_DEAL_RISK_SIGNALS = {
  name: 'detect_deal_risk_signals',
  description: 'Scan a deal and its counterparties for risk signals: document fraud, org risk flags, tariff exposure, payment anomalies, and concentration risk.',
  input_schema: {
    type: 'object',
    properties: {
      deal_id: { type: 'string' },
      org_ids: { type: 'array', items: { type: 'string' } },
      include_document_scan: { type: 'boolean', default: true },
    },
    required: ['deal_id'],
  },
}

const RECOMMEND_SUPPLIERS_FOR_BUYER = {
  name: 'recommend_suppliers_for_buyer',
  description: 'Find best-matched suppliers in the Strike network for a buyer\'s need. Ranks by product match, location, PassportScore, delivery rate, and price.',
  input_schema: {
    type: 'object',
    properties: {
      buyer_org_id: { type: 'string' },
      product_category: { type: 'string' },
      product_name: { type: 'string' },
      quantity: { type: 'number' },
      unit: { type: 'string' },
      delivery_location: { type: 'string' },
      required_delivery_date: { type: 'string', format: 'date' },
      budget_per_unit: { type: 'number' },
      currency: { type: 'string', default: 'USD' },
      min_passport_score: { type: 'number', default: 0 },
      limit: { type: 'number', default: 5 },
    },
    required: ['buyer_org_id', 'product_category'],
  },
}

const GENERATE_DEAL_TERM_SHEET = {
  name: 'generate_deal_term_sheet',
  description: 'Generate a structured term sheet for a deal: parties, goods, pricing, delivery, payment, financing, and milestones.',
  input_schema: {
    type: 'object',
    properties: {
      deal_id: { type: 'string' },
      include_financing: { type: 'boolean', default: true },
    },
    required: ['deal_id'],
  },
}

const EVALUATE_LISTING_OFFERS = {
  name: 'evaluate_listing_offers',
  description: 'Rank all active offers on a listing by price, delivery speed, and counterparty trust. Returns top recommendation with reasoning.',
  input_schema: {
    type: 'object',
    properties: {
      listing_id: { type: 'string' },
      priority: { type: 'string', enum: ['best_price', 'fastest_delivery', 'strongest_counterparty', 'balanced'] },
    },
    required: ['listing_id'],
  },
}

const GET_PASSPORT_ADVICE = {
  name: 'get_passport_advice',
  description: 'Explain an org\'s PassportScore: what\'s driving it up/down and specific actions to improve it with estimated score uplift.',
  input_schema: {
    type: 'object',
    properties: {
      org_id: { type: 'string' },
    },
    required: ['org_id'],
  },
}

const PROACTIVE_PORTFOLIO_ALERTS = {
  name: 'proactive_portfolio_alerts',
  description: 'Scan a bank\'s portfolio for issues: overdue payments, stuck deals, deteriorating performance, concentration risk, upcoming maturities. Bank users only.',
  input_schema: {
    type: 'object',
    properties: {
      bank_id: { type: 'string' },
      alert_types: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['overdue_payments', 'stuck_deals', 'deteriorating_performance', 'high_risk_flags', 'upcoming_maturities', 'concentration_risk'],
        },
      },
      days_horizon: { type: 'number', default: 30 },
    },
    required: ['bank_id'],
  },
}

// Portal-specific tool sets — only send what each role can actually use.
// Fewer tools = fewer input tokens on every request.
const SUPPLIER_TOOLS = [
  LOOKUP_ENTITIES,
  CREATE_MARKETPLACE_LISTING,
  GET_ACTIVE_DEALS,
  GET_PRICING_INSIGHTS,
  SCORE_AND_RANK_FINANCING_OFFERS,
  EVALUATE_LISTING_OFFERS,
  GET_PASSPORT_ADVICE,
  SUMMARIZE_DEAL_NEGOTIATION,
  DETECT_DEAL_RISK_SIGNALS,
]

const ANCHOR_TOOLS = [
  LOOKUP_ENTITIES,
  CREATE_MARKETPLACE_LISTING,
  GET_ACTIVE_DEALS,
  FIND_AND_RECOMMEND_DEALS,
  GET_PRICING_INSIGHTS,
  RECOMMEND_SUPPLIERS_FOR_BUYER,
  EVALUATE_SUPPLIER_PASSPORT,
  GENERATE_DEAL_TERM_SHEET,
  EVALUATE_LISTING_OFFERS,
  SUMMARIZE_DEAL_NEGOTIATION,
  DETECT_DEAL_RISK_SIGNALS,
  GET_PASSPORT_ADVICE,
]

const BANK_TOOLS = [
  LOOKUP_ENTITIES,
  GET_ACTIVE_DEALS,
  PROACTIVE_PORTFOLIO_ALERTS,
  SCORE_AND_RANK_FINANCING_OFFERS,
  EVALUATE_SUPPLIER_PASSPORT,
  DETECT_DEAL_RISK_SIGNALS,
  SUMMARIZE_DEAL_NEGOTIATION,
  GET_PASSPORT_ADVICE,
  GENERATE_DEAL_TERM_SHEET,
]

// Full set used as fallback and for type inference in execute.ts.
export const STRIKE_TOOLS = [
  LOOKUP_ENTITIES,
  CREATE_MARKETPLACE_LISTING,
  GET_ACTIVE_DEALS,
  EVALUATE_SUPPLIER_PASSPORT,
  FIND_AND_RECOMMEND_DEALS,
  GET_PRICING_INSIGHTS,
  SUMMARIZE_DEAL_NEGOTIATION,
  SCORE_AND_RANK_FINANCING_OFFERS,
  DETECT_DEAL_RISK_SIGNALS,
  RECOMMEND_SUPPLIERS_FOR_BUYER,
  GENERATE_DEAL_TERM_SHEET,
  EVALUATE_LISTING_OFFERS,
  GET_PASSPORT_ADVICE,
  PROACTIVE_PORTFOLIO_ALERTS,
] as const

export function getToolsForPortal(portal?: string) {
  switch (portal) {
    case 'supplier': return SUPPLIER_TOOLS
    case 'anchor':   return ANCHOR_TOOLS
    case 'bank':     return BANK_TOOLS
    default:         return STRIKE_TOOLS
  }
}
