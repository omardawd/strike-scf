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
  description: 'Create a marketplace listing (product/service or PO request) with line items. DOCUMENT MODE: When the user\'s message contains an [Attached document:] section, extract every listing field directly from that document (title, line items with quantities/units/prices, incoterms, payment terms, delivery date, delivery location, currency). Use org_id from context. Infer listing_type from portal: anchor/buyer → po_request, supplier → product_service. Call the tool immediately with all extracted fields — do not ask for info already present in the document. Only ask if a required field is genuinely absent. NO DOCUMENT: Ask for incoterms, payment terms, and visibility (public vs network_only) before calling. After success, always emit [LISTING_CARD:{listing_id}] on its own line.',
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

const SEARCH_MARKETPLACE_LISTINGS = {
  name: 'search_marketplace_listings',
  description: 'Search active public listings on Strike Place. Use this when the user asks about available deals, listings, PO requests, or products on the marketplace. After returning results, emit [LISTING_CARD:{id}] on its own line for EACH listing found so the UI renders a clickable card the user can navigate to.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Keyword to search for (e.g. "steel", "electronics"). Use "all" to list recent listings.' },
      org_id: { type: 'string', description: 'org_id from context. Include it so network_only listings this org can see are included, not just public ones.' },
      listing_type: { type: 'string', enum: ['po_request', 'product_service', 'all'], default: 'all', description: 'po_request = buyers looking to procure; product_service = suppliers offering goods/services' },
      category: { type: 'string', description: 'Filter by category (optional)' },
      max_budget: { type: 'number', description: 'Max target price filter (optional)' },
      delivery_location: { type: 'string', description: 'Filter by delivery location keyword (optional)' },
      limit: { type: 'number', default: 10 },
    },
    required: ['query'],
  },
}

const SUBMIT_MARKETPLACE_OFFER = {
  name: 'submit_marketplace_offer',
  description: 'Submit an offer on an existing Strike Place listing. Use this when the user wants to make an offer, bid, or respond to a listing — NOT when they want to create their own listing. Requires the listing_id (use search_marketplace_listings or lookup_entities first if you only have a title).',
  input_schema: {
    type: 'object',
    properties: {
      listing_id: { type: 'string', description: 'UUID of the listing to offer on' },
      from_org_id: { type: 'string', description: 'UUID of the offering organization (use org_id from context)' },
      offered_price: { type: 'number', description: 'Total offered price in the listing currency' },
      offered_quantity: { type: 'number', description: 'Quantity being offered' },
      proposed_delivery_date: { type: 'string', format: 'date', description: 'Proposed delivery date (YYYY-MM-DD)' },
      proposed_incoterms: { type: 'string', description: 'e.g. CIF, FOB, EXW' },
      proposed_payment_terms: { type: 'string', description: 'e.g. Net 30, LC at sight' },
      notes: { type: 'string', description: 'Any additional notes or terms to include with the offer' },
    },
    required: ['listing_id', 'from_org_id'],
  },
}

const COUNTER_MARKETPLACE_OFFER = {
  name: 'counter_marketplace_offer',
  description: 'Submit a counter-offer on an existing marketplace offer. Only valid when it is this org\'s turn to counter (the other party made the last move). Use evaluate_listing_offers or get_pricing_insights first to decide on fair terms.',
  input_schema: {
    type: 'object',
    properties: {
      offer_id: { type: 'string', description: 'UUID of the offer to counter' },
      acting_org_id: { type: 'string', description: 'org_id of the org submitting this counter (use org_id from context)' },
      offered_price: { type: 'number', description: 'Total counter price in the listing currency' },
      offered_quantity: { type: 'number' },
      proposed_delivery_date: { type: 'string', format: 'date' },
      proposed_incoterms: { type: 'string', description: 'e.g. CIF, FOB, EXW' },
      proposed_payment_terms: { type: 'string', description: 'e.g. Net 30, LC at sight' },
      shipping_cost: { type: 'number', description: 'Required when this org is the supplier and incoterms put main carriage on the seller' },
      notes: { type: 'string' },
    },
    required: ['offer_id', 'acting_org_id', 'offered_price'],
  },
}

const REJECT_MARKETPLACE_OFFER = {
  name: 'reject_marketplace_offer',
  description: 'Reject an offer on your own listing outright, ending the negotiation. Only the listing owner can reject. Use this when a counter-offer is clearly unacceptable rather than countering again.',
  input_schema: {
    type: 'object',
    properties: {
      offer_id: { type: 'string', description: 'UUID of the offer to reject' },
      acting_org_id: { type: 'string', description: 'org_id of the listing owner rejecting (use org_id from context)' },
      reason: { type: 'string', description: 'Brief reason for rejecting, for the audit trail' },
    },
    required: ['offer_id', 'acting_org_id'],
  },
}

// NOTE: accept_marketplace_offer intentionally has no schema wired into any
// portal's chat tool set below — accepting an offer creates a binding deal,
// and per the negotiation design that must only ever happen through a human
// explicitly approving a 'negotiation_ready_to_finalize' agent_tasks row
// (see app/api/agents/tasks/[id]/approve/route.ts), never via ad-hoc chat.

// Signal-only "tool" for the negotiation tick loop (app/api/agents/tick/route.ts).
// Not a real action — calling it does nothing on its own. It's how Claude tells
// the tick loop "the counterparty's current terms should be accepted" without
// ever being able to accept the offer itself; the tick loop intercepts this
// tool_use block directly (it is NOT registered in execute.ts/ToolName) and
// turns it into a 'negotiation_ready_to_finalize' agent_tasks row for GATE 2.
const RECOMMEND_FINALIZATION = {
  name: 'recommend_finalization',
  description: 'Call this when you believe the counterparty\'s current offer terms are good and should be accepted — NOT when you want to counter or reject. This does not accept the offer; it flags it for a human to make the final call.',
  input_schema: {
    type: 'object',
    properties: {
      offer_id: { type: 'string', description: 'UUID of the offer whose current terms you recommend accepting' },
      reasoning: { type: 'string', description: 'Brief explanation of why these terms are good, for the human reviewing it' },
    },
    required: ['offer_id', 'reasoning'],
  },
}

// Signal-only "tool" for per-task plan chats (app/api/agents/tasks/[id]/messages/route.ts).
// Not a real action — it never touches the database itself. Claude calls this
// when the human asks it to change the terms of a pending proposed action; the
// route intercepts the tool_use block directly (NOT registered in execute.ts/
// ToolName) and merges `patch` into the task's proposed_action.tool_input.
const REVISE_PROPOSED_ACTION = {
  name: 'revise_proposed_action',
  description: 'Update the terms of the currently proposed action based on what the human just asked for. Only include the fields that should change — they are merged into the existing action, not used to replace it wholesale.',
  input_schema: {
    type: 'object',
    properties: {
      patch: { type: 'object', description: 'Partial tool_input fields to change (e.g. {"amount": 75000})' },
      summary: { type: 'string', description: 'One sentence describing what changed, shown to the human in the thread' },
    },
    required: ['patch', 'summary'],
  },
}

// Bounded tool set for per-task plan chats — lets Strike AI look things up while
// discussing a pending proposal, and revise its terms, but never execute
// anything directly (approve/reject in the UI still own execution).
export const TASK_CHAT_TOOLS = [
  REVISE_PROPOSED_ACTION,
  LOOKUP_ENTITIES,
  GET_ACTIVE_DEALS,
  SEARCH_MARKETPLACE_LISTINGS,
  GET_PRICING_INSIGHTS,
  EVALUATE_LISTING_OFFERS,
]

const SEARCH_WEB = {
  name: 'search_web',
  description: 'Search the internet for current market prices, commodity rates, trade regulations, incoterms guidance, industry benchmarks, or any real-world factual information. Use when the user asks about market rates, current pricing, trade standards, or anything that requires up-to-date external data.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query — be specific (e.g. "wood pallet price per unit NYC 2026" not just "pallet price")' },
      topic: { type: 'string', enum: ['general', 'news', 'finance'], default: 'general', description: 'Use "finance" for commodity/market data, "news" for current events, "general" for everything else' },
      max_results: { type: 'number', default: 5, description: 'Number of results to return (1–10)' },
    },
    required: ['query'],
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

const GET_ERP_DATA = {
  name: 'get_erp_data',
  description: 'Read live ERP data synced from the organization\'s connected ERP system (ERPNext, NetSuite, SAP, etc). Returns cash position, AR aging, AP aging, inventory levels, and open orders. Also surfaces proactive advisories — low inventory, overdue receivables, cash stress. Use when the user asks about their financial position, inventory, orders, or when proactively scanning for actionable signals.',
  input_schema: {
    type: 'object',
    properties: {
      org_id: { type: 'string', description: 'Organization ID to read ERP data for' },
      data_type: {
        type: 'string',
        enum: ['ar_aging', 'ap_aging', 'cash_position', 'inventory_levels', 'open_orders', 'all'],
        default: 'all',
        description: 'Which ERP dataset to retrieve. Use "all" for a full overview.',
      },
    },
    required: ['org_id'],
  },
}

const GET_AGENT_TASKS = {
  name: 'get_agent_tasks',
  description: 'List the AI agent\'s pending proposals and recent task history for an org. Use when the user asks what their agent is doing, what proposals are waiting, or to review agent activity.',
  input_schema: {
    type: 'object',
    properties: {
      org_id: { type: 'string' },
      status: { type: 'string', enum: ['awaiting_approval', 'completed', 'failed', 'rejected', 'all'], default: 'all' },
      limit:  { type: 'number', default: 20 },
    },
    required: ['org_id'],
  },
}

const CREATE_FINANCING_REQUEST = {
  name: 'create_financing_request',
  description: 'Post a receivables or trade financing request to Strike Place so banks can submit offers. Use this — NOT create_marketplace_listing — whenever the user wants to finance an invoice, receivable, or existing trade. For ERP-sourced invoices with no Strike deal yet, provide invoice details and a deal is auto-imported. Always prefer invoice_factoring for AR/receivables financing.',
  input_schema: {
    type: 'object',
    properties: {
      org_id:               { type: 'string' },
      deal_id:              { type: 'string', description: 'Existing Strike deal ID. Omit if financing an ERP invoice — the deal will be auto-imported.' },
      invoice_description:  { type: 'string', description: 'Short description of the invoice/receivable, e.g. "AR invoice — Walmart eCommerce"' },
      amount:               { type: 'number', description: 'Total amount to finance' },
      currency:             { type: 'string', default: 'USD' },
      counterparty_name:    { type: 'string', description: 'Buyer/debtor name (e.g. "Walmart eCommerce")' },
      invoice_due_date:     { type: 'string', format: 'date', description: 'Invoice due date YYYY-MM-DD' },
      financing_type:       { type: 'string', enum: ['invoice_factoring', 'reverse_factoring', 'po_financing', 'dynamic_discounting'], default: 'invoice_factoring' },
      structure_type:       { type: 'string', enum: ['preset', 'custom', 'open'], default: 'open' },
      preferred_tenor_days: { type: 'number', description: 'Financing tenor in days, e.g. 60' },
      preferred_rate_max:   { type: 'number', description: 'Maximum acceptable rate (APR %)' },
    },
    required: ['org_id', 'amount'],
  },
}

// Portal-specific tool sets — only send what each role can actually use.
// Fewer tools = fewer input tokens on every request.
const SUPPLIER_TOOLS = [
  LOOKUP_ENTITIES,
  SEARCH_WEB,
  SEARCH_MARKETPLACE_LISTINGS,
  SUBMIT_MARKETPLACE_OFFER,
  COUNTER_MARKETPLACE_OFFER,
  REJECT_MARKETPLACE_OFFER,
  CREATE_MARKETPLACE_LISTING,
  CREATE_FINANCING_REQUEST,
  GET_ACTIVE_DEALS,
  FIND_AND_RECOMMEND_DEALS,
  GET_PRICING_INSIGHTS,
  SCORE_AND_RANK_FINANCING_OFFERS,
  EVALUATE_LISTING_OFFERS,
  GET_PASSPORT_ADVICE,
  SUMMARIZE_DEAL_NEGOTIATION,
  DETECT_DEAL_RISK_SIGNALS,
  GENERATE_DEAL_TERM_SHEET,
  GET_ERP_DATA,
  GET_AGENT_TASKS,
  PROACTIVE_PORTFOLIO_ALERTS,
]

const ANCHOR_TOOLS = [
  LOOKUP_ENTITIES,
  SEARCH_WEB,
  SEARCH_MARKETPLACE_LISTINGS,
  SUBMIT_MARKETPLACE_OFFER,
  COUNTER_MARKETPLACE_OFFER,
  REJECT_MARKETPLACE_OFFER,
  CREATE_MARKETPLACE_LISTING,
  CREATE_FINANCING_REQUEST,
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
  GET_ERP_DATA,
  GET_AGENT_TASKS,
]

const BANK_TOOLS = [
  LOOKUP_ENTITIES,
  SEARCH_WEB,
  SEARCH_MARKETPLACE_LISTINGS,
  SUBMIT_MARKETPLACE_OFFER,
  COUNTER_MARKETPLACE_OFFER,
  REJECT_MARKETPLACE_OFFER,
  GET_ACTIVE_DEALS,
  FIND_AND_RECOMMEND_DEALS,
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
  SEARCH_WEB,
  SEARCH_MARKETPLACE_LISTINGS,
  SUBMIT_MARKETPLACE_OFFER,
  COUNTER_MARKETPLACE_OFFER,
  REJECT_MARKETPLACE_OFFER,
  CREATE_MARKETPLACE_LISTING,
  CREATE_FINANCING_REQUEST,
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
  GET_ERP_DATA,
  GET_AGENT_TASKS,
] as const

// Bounded tool set for the autonomous negotiation tick loop (see
// app/api/agents/tick/route.ts). Deliberately excludes accept_marketplace_offer —
// finalizing a deal always requires a separate human approval (GATE 2), never
// a live Claude tool-use decision inside the tick loop.
export const NEGOTIATION_TOOLS = [
  COUNTER_MARKETPLACE_OFFER,
  REJECT_MARKETPLACE_OFFER,
  RECOMMEND_FINALIZATION,
  GET_PRICING_INSIGHTS,
  EVALUATE_LISTING_OFFERS,
]

const GET_FINANCING_PROGRAMS = {
  name: 'get_financing_programs',
  description: 'Fetch the financing programs that an organization is enrolled in on Strike. Use when the user asks about available financing options, which program to use, financing rates, deal size limits, or tenor. Requires the org_id from page context.',
  input_schema: {
    type: 'object',
    properties: {
      org_id: { type: 'string', description: 'The organization ID to look up programs for' },
    },
    required: ['org_id'],
  },
}

// Overlay tools — web search only. No write/action tools.
// Financing questions on deal pages are answered from page context directly.
export const OVERLAY_TOOLS = [SEARCH_WEB]

export function getToolsForPortal(portal?: string) {
  switch (portal) {
    case 'supplier': return SUPPLIER_TOOLS
    case 'anchor':   return ANCHOR_TOOLS
    case 'bank':     return BANK_TOOLS
    default:         return STRIKE_TOOLS
  }
}
