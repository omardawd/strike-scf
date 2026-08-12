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
  description: 'Create a marketplace listing (product/service or PO request) with line items. DOCUMENT MODE: When the user\'s message contains an [Attached document:] section, extract every listing field directly from that document (title, line items with quantities/units/prices, incoterms, shipping_cost, payment terms, delivery date, delivery location, currency). Use org_id from context. Infer listing_type from portal: anchor/buyer → po_request, supplier → product_service. Call the tool immediately with all extracted fields — do not ask for info already present in the document. Only ask if a required field is genuinely absent. NO DOCUMENT: Ask for incoterms, payment terms, and visibility (public vs network_only) before calling. If incoterms is one that puts shipping cost on the seller (CFR, CIF, CPT, CIP, DAP, DPU, or DDP), also ask for shipping_cost up front — don\'t leave it to be figured out later during offer negotiation. After success, always emit [LISTING_CARD:{listing_id}] on its own line.',
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
      shipping_cost: { type: 'number', description: 'Required when incoterms puts shipping on the seller: CFR, CIF, CPT, CIP, DAP, DPU, or DDP. Always ask for this at listing creation for those incoterms — never leave it to be set later.' },
      payment_terms: { type: 'string', description: 'e.g. Net 30, LC at sight, CAD — always ask if not provided' },
      expires_at: { type: 'string', format: 'date-time' },
      min_passport_score: { type: 'number', description: 'Minimum PassportScore to submit an offer (0–100)' },
      tags: { type: 'array', items: { type: 'string' } },
      visibility: { type: 'string', enum: ['public', 'network_only'], default: 'public' },
      network_id: { type: 'string', description: 'Required if visibility=network_only' },
      line_items: {
        type: 'array',
        description: 'Required — a listing\'s total price is always derived from these, never a number you set directly. Every item needs a real quantity and unit_price; never omit pricing or leave it to be filled in later.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            quantity: { type: 'number', description: 'Required — must be greater than 0.' },
            unit: { type: 'string', default: 'units' },
            unit_price: { type: 'number', description: 'Required — must be greater than 0.' },
            specs: { type: 'object' },
          },
          required: ['name', 'quantity', 'unit_price'],
        },
      },
    },
    required: ['org_id', 'listing_type', 'title', 'line_items'],
  },
}

const GET_ACTIVE_DEALS = {
  name: 'get_active_deals',
  description: 'List all active (non-completed, non-cancelled) deals for an org, including each deal\'s finalized value (value/currency fields — falls back from total_value to the earlier-set agreed_price so in-flight deals still report a real number) and a summary.total_value across the whole set. Use when the user asks about current deals, deal status, payment due dates, or deal VALUES (e.g. a bar chart of deals by value) — the data needed for a value-based breakdown is already here, no need to fetch term sheets separately.',
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

const GET_DEAL_WORKFLOW = {
  name: 'get_deal_workflow',
  description: 'List the buyer-customized checkpoints for a deal. The caller must be the buyer or supplier on that deal.',
  input_schema: {
    type: 'object',
    properties: { deal_id: { type: 'string', description: 'Full deal UUID' } },
    required: ['deal_id'],
  },
}

const PROPOSE_DEAL_WORKFLOW_STEP = {
  name: 'propose_deal_workflow_step',
  description: 'Add a negotiated checkpoint to a deal workflow. Only the organization playing the buyer role on this specific deal may propose it; organization type does not determine this permission.',
  input_schema: {
    type: 'object',
    properties: {
      deal_id: { type: 'string', description: 'Full deal UUID' },
      title: { type: 'string' },
      description: { type: 'string' },
      responsible_party: { type: 'string', enum: ['buyer', 'supplier', 'both'] },
      requires_document: { type: 'boolean', default: false },
      due_at: { type: 'string', format: 'date-time' },
    },
    required: ['deal_id', 'title', 'responsible_party'],
  },
}

const FIND_ELIGIBLE_SUPPLIERS = {
  name: 'find_eligible_suppliers',
  description: 'List suppliers eligible to be invited to a specific po_request listing you own — scoped to that listing\'s own network/marketplace visibility rule, and filtered to currently admitted (KYB-approved, active) organizations. Never returns a general supplier directory; always scoped to one listing_id.',
  input_schema: {
    type: 'object',
    properties: { listing_id: { type: 'string', description: 'Full listing UUID — must be a listing you own' } },
    required: ['listing_id'],
  },
}

const DRAFT_SOURCING_REQUEST = {
  name: 'draft_sourcing_request',
  description: 'Draft the fields for a po_request sourcing listing and flag which material fields (quantity, delivery deadline/location, incoterms, payment terms) are still missing. Returns a draft only — never creates a listing. The buyer must review and publish it themselves through the existing listing creation page.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      category: { type: 'string' },
      quantity: { type: 'number' },
      unit: { type: 'string' },
      target_price: { type: 'number' },
      currency: { type: 'string', default: 'USD' },
      delivery_deadline: { type: 'string', format: 'date' },
      delivery_location: { type: 'string' },
      incoterms: { type: 'string' },
      payment_terms: { type: 'string' },
    },
    required: ['title'],
  },
}

const DRAFT_SUPPLIER_OUTREACH = {
  name: 'draft_supplier_outreach',
  description: 'Draft an outreach message inviting a specific organization to quote on your po_request listing. Returns text only — never sends anything. You must send it yourself.',
  input_schema: {
    type: 'object',
    properties: {
      listing_id: { type: 'string', description: 'Your own listing UUID' },
      target_org_id: { type: 'string', description: 'The organization to draft a message to' },
    },
    required: ['listing_id', 'target_org_id'],
  },
}

const RECOMMEND_AWARD = {
  name: 'recommend_award',
  description: 'Create a NON-BINDING award recommendation for a po_request listing you own, naming one offer as the proposed winner with rationale, risks, and comparison. This does NOT accept the offer or create a deal — it posts an approval task to the Agent tab. The buyer must explicitly approve it there before anything binding happens; that approval (not this tool) is what accepts the offer.',
  input_schema: {
    type: 'object',
    properties: {
      listing_id: { type: 'string', description: 'Your own po_request listing UUID' },
      offer_id: { type: 'string', description: 'The offer being recommended — must belong to listing_id' },
      rationale: { type: 'string', description: 'Why this offer is recommended' },
      risks: { type: 'string', description: 'Any risks or caveats to flag to the buyer' },
      comparison: { type: 'object', description: 'Optional structured comparison data against other offers' },
    },
    required: ['listing_id', 'offer_id', 'rationale'],
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

// Signal-only "tool" for the autonomous negotiation tick loop. Not a real
// action — it never touches offer_rounds, agent_negotiations, or any deal
// state. Claude calls this when the counterparty's latest Room message is
// primarily an informational question (certifications, quality process,
// compliance, company background, product specs) rather than a price/terms
// move — the tick loop intercepts this tool_use block directly (it is NOT
// registered in execute.ts/ToolName) and simply posts the answer into the
// shared Room, so the negotiation keeps its real-deal-cycle feel (a human or
// counterparty agent can ask "are you ISO certified?" and get a grounded
// answer) without ever advancing or resetting the negotiation's state.
const ANSWER_QUESTION = {
  name: 'answer_question',
  description: 'Post an answer to an informational question the counterparty asked in the shared Room chat (about certifications, quality, compliance, specs, company background, etc.) — use this INSTEAD of counter_marketplace_offer/reject_marketplace_offer when their latest message is purely a question with no new price or terms proposed. If they asked a question AND proposed new terms in the same message, answer the question inside your counter/reject notes instead of calling this separately.',
  input_schema: {
    type: 'object',
    properties: {
      answer: { type: 'string', description: 'A specific, helpful answer grounded in the listing/company context you were given — never invent a certification or fact you were not given evidence for; say so plainly if the information is not available rather than guessing.' },
    },
    required: ['answer'],
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

// Signal-only "tool" for per-task plan chats. Not a real action — it never
// touches marketplace_offers/agent_negotiations, and it can NEVER cause an
// offer to be accepted. It only lets a human adjust the standing guardrails
// (price_ceiling/price_floor/max_rounds) on an ALREADY-EXECUTING negotiation
// via chat — e.g. "get more aggressive, ceiling is now $420k" — mid-round.
// The tick loop (lib/ai/agent-tick.ts) reads agent_tasks.plan fresh on every
// tick, so a revision here takes effect on the negotiation's next tick with
// no extra wiring. GATE 2 (a human approving the exact final terms before
// accept_marketplace_offer ever runs) is completely unaffected by this tool —
// it cannot be used to pre-authorize an accept, only to change what the
// autonomous loop is allowed to counter with.
const REVISE_NEGOTIATION_PLAN = {
  name: 'revise_negotiation_plan',
  description: 'Update the standing guardrails (price ceiling, price floor, max rounds) on a negotiation that is CURRENTLY EXECUTING autonomously. Use this when the human asks to change how aggressive/permissive the agent should be mid-negotiation. This never accepts or finalizes anything — a human still approves the exact final terms separately before any deal is created.',
  input_schema: {
    type: 'object',
    properties: {
      price_ceiling: { type: 'number', description: 'New max price the agent may counter up to / accept-recommend at (buyer side), omit to leave unchanged' },
      price_floor: { type: 'number', description: 'New min price the agent may counter down to / accept-recommend at (seller side), omit to leave unchanged' },
      max_rounds: { type: 'number', description: 'New cap on negotiation rounds (still bounded by the platform-wide hard max), omit to leave unchanged' },
      summary: { type: 'string', description: 'One sentence describing what changed, shown to the human in the thread' },
    },
    required: ['summary'],
  },
}

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

const REQUEST_SOURCING_SEARCH = {
  name: 'request_sourcing_search',
  description: 'Start Strike Sourcing: a deep, multi-round research job that searches Strike Place plus the open web (including niche/buried suppliers a keyword search would miss) to find and evidence-qualify suppliers for a product/spec request. Before calling this, make sure the request has enough detail to search well — if something is genuinely ambiguous (e.g. an amount that could mean weight or capacity) either state your best interpretation or ask one quick clarifying question first. This is asynchronous and takes roughly 1-3 minutes; tell the user that up front. Returns a job_id immediately — after calling, always emit [[STRIKE_BLOCK:{"type":"sourcing_job","job_id":"<id>"}]] on its own line so the UI shows live progress and results.',
  input_schema: {
    type: 'object',
    properties: {
      org_id: { type: 'string' },
      query: { type: 'string', description: 'The sourcing request, in full detail — include any specs, quantities, price targets, and location/certification requirements the user has given' },
    },
    required: ['org_id', 'query'],
  },
}

const GET_SOURCING_SEARCH_STATUS = {
  name: 'get_sourcing_search_status',
  description: 'Check the progress or read the outcome of a Strike Sourcing job started with request_sourcing_search. The live progress card already polls this automatically — only call this tool yourself if the user asks about status in plain chat outside that card, or asks to see the actual candidates/results in the conversation. If the response includes unqualified_leads, relay them directly (title/domain/url) and label them clearly as unverified leads that were not evidence-qualified, not as vetted suppliers — never say the raw candidate list "isn\'t available", it\'s in this field when it exists. If resumable is false (a completed/failed job), do not offer to run another round or continue this same search — that isn\'t possible; instead offer a fresh request_sourcing_search call with broadened terms, or the other paths (PO request, marketplace search).',
  input_schema: {
    type: 'object',
    properties: { job_id: { type: 'string' } },
    required: ['job_id'],
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

const GET_CAPITAL_POSITION = {
  name: 'get_capital_position',
  description: 'Synthesize an organization\'s cash position, receivables/payables aging (from ERP if connected), and deal-book concentration risk into one view. Use this whenever the user asks a strategic question like "should we take this deal", "can we afford this", or "what does this do to our risk concentration" — it is the single call that answers cash + risk together instead of chaining several narrower tools. Pass hypothetical_deal_value (and hypothetical_counterparty_org_id if known) to model taking on ONE more deal on top of the current book.',
  input_schema: {
    type: 'object',
    properties: {
      org_id: { type: 'string', description: 'Organization ID to assess (use org_id from context)' },
      hypothetical_deal_value: { type: 'number', description: 'Value of a deal being considered, to model its effect on cash/concentration alongside the current position' },
      hypothetical_counterparty_org_id: { type: 'string', description: 'org_id of the counterparty on the hypothetical deal, if known — sharpens the concentration-risk delta' },
    },
    required: ['org_id'],
  },
}

const GENERATE_DOCUMENT = {
  name: 'generate_document',
  description: 'Create a real, downloadable file and hand it to the user in chat — use whenever they ask for an export, spreadsheet, report, or printout instead of just describing the data in prose. "trades_export" builds an .xlsx of the org\'s (or bank\'s) trades/transactions over a recent window — pass org_id for an org user\'s own deals, or bank_id for a bank\'s financed transactions, plus date_range_days (e.g. "last 4 weeks" → 28). "passport_score_report" builds a one-page PDF summary of an org\'s PassportScore, credit breakdown, and trade history — pass org_id. After the tool returns, emit exactly one [[STRIKE_BLOCK:{"type":"document","title":"...","filename":"...","download_url":"...","description":"optional one-line summary"}]] directive using the returned filename and download_url so the user gets a clickable download card — do not just paste the raw URL as a link.',
  input_schema: {
    type: 'object',
    properties: {
      document_type: { type: 'string', enum: ['trades_export', 'passport_score_report'], description: 'Which document to generate' },
      org_id: { type: 'string', description: 'Organization ID — required for passport_score_report; required for trades_export unless bank_id is given' },
      bank_id: { type: 'string', description: 'Bank ID — use for a bank user\'s trades_export instead of org_id' },
      date_range_days: { type: 'number', description: 'How many days back to include, for trades_export (e.g. 28 for "last 4 weeks", 90 for "last quarter"). Defaults to 28.' },
      title: { type: 'string', description: 'Optional display title for the generated document' },
    },
    required: ['document_type'],
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

const CREATE_NETWORK = {
  name: 'create_network',
  description: 'Create a private supplier/business network the org owns and can invite other organizations to. Use when the user asks to create a network or supplier group. "Private" means visibility_default: network_only (new listings posted to it default to network-only visibility); use "public" only if the user explicitly wants it open.',
  input_schema: {
    type: 'object',
    properties: {
      org_id: { type: 'string', description: 'The owning org (use org_id from context)' },
      name: { type: 'string', description: 'Network name, max 60 characters' },
      description: { type: 'string' },
      visibility_default: { type: 'string', enum: ['public', 'network_only'], default: 'public', description: 'Use "network_only" for a private network' },
    },
    required: ['org_id', 'name'],
  },
}

const ADD_NETWORK_MEMBER = {
  name: 'add_network_member',
  description: 'Invite an organization to join a network the caller\'s org owns. Requires network_id (from create_network or lookup) and either target_org_id (an org already on Strike — use lookup_entities with entity_type:"organization" first) or email (to invite a business not yet on Strike). If lookup_entities finds no match, use the email path instead of guessing an org_id.',
  input_schema: {
    type: 'object',
    properties: {
      org_id: { type: 'string', description: 'The network-owning org making the invite (use org_id from context)' },
      network_id: { type: 'string' },
      target_org_id: { type: 'string', description: 'UUID of an existing org on Strike to invite' },
      email: { type: 'string', description: 'Email to invite a business not yet on Strike (used only if target_org_id is not available)' },
      notes: { type: 'string', description: 'Optional personal note included in the invite' },
    },
    required: ['org_id', 'network_id'],
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

const GET_BOARD = {
  name: 'get_board',
  description: 'Read the caller\'s org/bank Team Board: its workflow stages (columns), the arrows/connections between them, and its tasks (with assignee, priority, due date). Use when the user asks what\'s on the board, what stage something is in, or who\'s working on what.',
  input_schema: {
    type: 'object',
    properties: {},
  },
}

const DESIGN_BOARD_WORKFLOW = {
  name: 'design_board_workflow',
  description: 'Design (or redesign) the org/bank Team Board\'s workflow: replaces its full set of stages (columns) and the arrows between them in one call. Use when the user describes a workflow by chatting, e.g. "set up a workflow: Intake, Review, Approved, Rejected, Done, with Review branching to Approved or Rejected". Existing tasks are automatically kept and moved to the stage with the closest matching name (or the first stage if none matches) — never deleted. Org/bank admins only.',
  input_schema: {
    type: 'object',
    properties: {
      columns: {
        type: 'array',
        description: 'The full ordered list of stages the board should have after this call',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Stage name, e.g. "Review"' },
            position: { type: 'number', description: 'Left-to-right order, 0-based. Defaults to array order.' },
          },
          required: ['name'],
        },
      },
      edges: {
        type: 'array',
        description: 'Arrows between stages, shown in the flow-graph view. Reference stages by the exact name used in columns.',
        items: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'Source stage name' },
            to: { type: 'string', description: 'Destination stage name' },
            label: { type: 'string', description: 'Optional label on the arrow, e.g. "if rejected"' },
          },
          required: ['from', 'to'],
        },
      },
    },
    required: ['columns'],
  },
}

const CREATE_BOARD_TASK = {
  name: 'create_board_task',
  description: 'Create a task on the org/bank Team Board and optionally assign it to a teammate. Use when the user asks to add a task, ticket, or to-do to the board. Org/bank admins only (assigning work is a workflow-design action).',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Task title, max 160 characters' },
      column_name: { type: 'string', description: 'Stage to place the task in, by name. Defaults to the first stage if omitted.' },
      column_id: { type: 'string', description: 'Stage UUID, if already known — prefer column_name otherwise' },
      description: { type: 'string' },
      assignee_email: { type: 'string', description: 'Email of the teammate to assign the task to (must be in the same org/bank)' },
      priority: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium' },
      due_date: { type: 'string', format: 'date' },
    },
    required: ['title'],
  },
}

const ASSIGN_BOARD_TASK = {
  name: 'assign_board_task',
  description: 'Reassign an existing Team Board task to a different teammate by email. Org/bank admins only.',
  input_schema: {
    type: 'object',
    properties: {
      task_id: { type: 'string' },
      assignee_email: { type: 'string', description: 'Email of the teammate to assign the task to (must be in the same org/bank)' },
    },
    required: ['task_id', 'assignee_email'],
  },
}

const MOVE_BOARD_TASK = {
  name: 'move_board_task',
  description: 'Move a Team Board task to a different workflow stage. Any user can move a task assigned to themselves; org/bank admins can move any task.',
  input_schema: {
    type: 'object',
    properties: {
      task_id: { type: 'string' },
      column_name: { type: 'string', description: 'Target stage name' },
      column_id: { type: 'string', description: 'Target stage UUID, if already known — prefer column_name otherwise' },
    },
    required: ['task_id'],
  },
}

// Bounded tool set for per-task plan chats — lets Strike AI look things up while
// discussing a pending proposal, revise its terms, or adjust guardrails on a
// live negotiation, but never execute anything directly (approve/reject in
// the UI still own execution, and GATE 2 always owns finalization).
export const TASK_CHAT_TOOLS = [
  REVISE_PROPOSED_ACTION,
  REVISE_NEGOTIATION_PLAN,
  LOOKUP_ENTITIES,
  GET_ACTIVE_DEALS,
  SEARCH_MARKETPLACE_LISTINGS,
  GET_PRICING_INSIGHTS,
  EVALUATE_LISTING_OFFERS,
  CREATE_FINANCING_REQUEST,
]

// Unified tool set for any organization — any org can both buy and sell, so
// there's no more anchor-only vs supplier-only split (this is the union of
// the former ANCHOR_TOOLS/SUPPLIER_TOOLS sets). Fewer tools than STRIKE_TOOLS
// (bank/admin-only tools excluded) = fewer input tokens on every request.
const ORG_TOOLS = [
  LOOKUP_ENTITIES,
  SEARCH_WEB,
  SEARCH_MARKETPLACE_LISTINGS,
  SUBMIT_MARKETPLACE_OFFER,
  COUNTER_MARKETPLACE_OFFER,
  REJECT_MARKETPLACE_OFFER,
  CREATE_MARKETPLACE_LISTING,
  CREATE_FINANCING_REQUEST,
  CREATE_NETWORK,
  ADD_NETWORK_MEMBER,
  GET_ACTIVE_DEALS,
  GET_DEAL_WORKFLOW,
  PROPOSE_DEAL_WORKFLOW_STEP,
  FIND_ELIGIBLE_SUPPLIERS,
  DRAFT_SOURCING_REQUEST,
  DRAFT_SUPPLIER_OUTREACH,
  RECOMMEND_AWARD,
  FIND_AND_RECOMMEND_DEALS,
  GET_PRICING_INSIGHTS,
  SCORE_AND_RANK_FINANCING_OFFERS,
  RECOMMEND_SUPPLIERS_FOR_BUYER,
  EVALUATE_SUPPLIER_PASSPORT,
  EVALUATE_LISTING_OFFERS,
  GET_PASSPORT_ADVICE,
  SUMMARIZE_DEAL_NEGOTIATION,
  DETECT_DEAL_RISK_SIGNALS,
  GENERATE_DEAL_TERM_SHEET,
  GET_ERP_DATA,
  GET_CAPITAL_POSITION,
  GET_AGENT_TASKS,
  PROACTIVE_PORTFOLIO_ALERTS,
  GENERATE_DOCUMENT,
  REQUEST_SOURCING_SEARCH,
  GET_SOURCING_SEARCH_STATUS,
  GET_BOARD,
  DESIGN_BOARD_WORKFLOW,
  CREATE_BOARD_TASK,
  ASSIGN_BOARD_TASK,
  MOVE_BOARD_TASK,
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
  GENERATE_DOCUMENT,
  GET_BOARD,
  DESIGN_BOARD_WORKFLOW,
  CREATE_BOARD_TASK,
  ASSIGN_BOARD_TASK,
  MOVE_BOARD_TASK,
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
  CREATE_NETWORK,
  ADD_NETWORK_MEMBER,
  GET_ACTIVE_DEALS,
  GET_DEAL_WORKFLOW,
  PROPOSE_DEAL_WORKFLOW_STEP,
  FIND_ELIGIBLE_SUPPLIERS,
  DRAFT_SOURCING_REQUEST,
  DRAFT_SUPPLIER_OUTREACH,
  RECOMMEND_AWARD,
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
  GET_CAPITAL_POSITION,
  GET_AGENT_TASKS,
  GENERATE_DOCUMENT,
  REQUEST_SOURCING_SEARCH,
  GET_SOURCING_SEARCH_STATUS,
  GET_BOARD,
  DESIGN_BOARD_WORKFLOW,
  CREATE_BOARD_TASK,
  ASSIGN_BOARD_TASK,
  MOVE_BOARD_TASK,
] as const

// Bounded tool set for the autonomous negotiation tick loop (see
// app/api/agents/tick/route.ts). Deliberately excludes accept_marketplace_offer —
// finalizing a deal always requires a separate human approval (GATE 2), never
// a live Claude tool-use decision inside the tick loop.
export const NEGOTIATION_TOOLS = [
  COUNTER_MARKETPLACE_OFFER,
  REJECT_MARKETPLACE_OFFER,
  RECOMMEND_FINALIZATION,
  ANSWER_QUESTION,
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
    // 'anchor'/'supplier' kept as aliases for 'org' until every caller is
    // migrated off the old PortalType values — same unified tool set either way.
    case 'org':
    case 'supplier':
    case 'anchor':   return ORG_TOOLS
    case 'bank':     return BANK_TOOLS
    default:         return STRIKE_TOOLS
  }
}
