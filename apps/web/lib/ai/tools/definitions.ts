// Claude tool definitions for Strike SCF.
// These are passed to the Anthropic API so Claude knows when and how to call each tool.
// The actual execution happens in /api/ai/tools/execute via handlers.ts.

export const STRIKE_TOOLS = [
  {
    name: 'lookup_entities',
    description:
      'Resolve a human-readable name or description to platform UUIDs. ' +
      'ALWAYS call this first when the user refers to a supplier, buyer, deal, or financing request by name ' +
      'rather than a UUID (e.g. "Westcoast Fabricators", "my deal with Pacific", "latest financing request"). ' +
      'Returns matching records with their IDs so you can pass them to other tools.',
    input_schema: {
      type: 'object',
      properties: {
        entity_type: {
          type: 'string',
          enum: ['organization', 'deal', 'financing_request'],
          description: 'What kind of entity to look up',
        },
        query: {
          type: 'string',
          description: 'Name or keyword to search for. Use "all" to list recent records.',
        },
        org_id: {
          type: 'string',
          description: 'Scope deal/financing_request search to this org (use the user\'s org_id from context)',
        },
        limit: { type: 'number', default: 5 },
      },
      required: ['entity_type', 'query'],
    },
  },


  {
    name: 'create_marketplace_listing',
    description:
      'Create a new marketplace listing (product/service or PO request) with detailed line items. ' +
      'Can be driven entirely by conversation — no document required. ' +
      'Inserts into marketplace_listings and listing_line_items tables.',
    input_schema: {
      type: 'object',
      properties: {
        org_id: { type: 'string', description: 'UUID of the posting organization' },
        listing_type: {
          type: 'string',
          enum: ['po_request', 'product_service'],
          description: 'po_request = buyer wants to procure; product_service = supplier offering goods/services',
        },
        title: { type: 'string', description: 'Listing title' },
        description: { type: 'string', description: 'Detailed listing description' },
        category: { type: 'string', description: 'Product/service category (e.g. "Steel", "Electronics", "Logistics")' },
        currency: { type: 'string', default: 'USD' },
        delivery_deadline: { type: 'string', format: 'date', description: 'Required delivery date (YYYY-MM-DD)' },
        delivery_location: { type: 'string', description: 'Delivery city, state/country (e.g. "NYC Port, New York, USA")' },
        expires_at: { type: 'string', format: 'date-time', description: 'When the listing expires (ISO 8601). Use end-of-day for date-only inputs, e.g. "2025-07-31T23:59:59Z"' },
        min_passport_score: { type: 'number', description: 'Minimum PassportScore required to submit an offer (0-100). Offers from orgs below this score are blocked.' },
        tags: { type: 'array', items: { type: 'string' } },
        visibility: {
          type: 'string',
          enum: ['public', 'network_only'],
          default: 'public',
          description: 'public = visible to all network members; network_only = restricted to a specific anchor network',
        },
        network_id: { type: 'string', description: 'Required if visibility=network_only; UUID of anchor_networks row' },
        line_items: {
          type: 'array',
          description: 'Individual products or services in this listing',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Item name (e.g. "Hot-rolled steel coil 2mm")' },
              description: { type: 'string' },
              quantity: { type: 'number', description: 'Quantity needed/offered' },
              unit: { type: 'string', default: 'units', description: 'Unit of measure (units, kg, MT, pcs, etc.)' },
              unit_price: { type: 'number', description: 'Price per unit in the listing currency' },
              specs: {
                type: 'object',
                description: 'Flexible key-value product specifications, e.g. { "grade": "A36", "thickness_mm": 2, "width_mm": 1200 }',
              },
              specs_flexible: {
                type: 'boolean',
                default: false,
                description: 'If true, specs are negotiable',
              },
            },
            required: ['name'],
          },
        },
      },
      required: ['org_id', 'listing_type', 'title', 'line_items'],
    },
  },

  {
    name: 'evaluate_supplier_passport',
    description:
      'Comprehensively evaluate a supplier or anchor organization using all available platform data: ' +
      'business profile, KYB compliance status, uploaded financials, credit scores, deal history, ' +
      'peer reviews, performance metrics, risk flags, financing behavior, and supply chain footprint. ' +
      'Claude AI scores the result holistically and writes the score back to the organization\'s PassportScore. ' +
      'If you only have a name (not a UUID), call lookup_entities first to get the supplier_org_id.',
    input_schema: {
      type: 'object',
      properties: {
        supplier_org_id: { type: 'string', description: 'UUID of the organization to evaluate. Use lookup_entities if you only have a name.' },
        requesting_org_id: {
          type: 'string',
          description: 'UUID of the organization requesting the evaluation (for context; optional)',
        },
        evaluation_purpose: {
          type: 'string',
          enum: ['deal_approval', 'financing_decision', 'partnership_vetting', 'network_onboarding', 'general'],
        },
        include_sections: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'business_profile',
              'kyb_compliance',
              'financial_health',
              'platform_history',
              'peer_reviews',
              'performance_metrics',
              'risk_flags',
              'financing_behavior',
              'supply_chain_footprint',
            ],
          },
          description: 'Which sections to include. Defaults to all except supply_chain_footprint.',
        },
      },
      required: ['supplier_org_id', 'evaluation_purpose'],
    },
  },

  {
    name: 'find_and_recommend_deals',
    description:
      'Find and evaluate potential deals between a buyer and supplier by matching products/specs, ' +
      'delivery requirements, pricing, location, and both parties\' Passport profiles. ' +
      'Returns a scored recommendation with match breakdown and suggested deal terms. ' +
      'If you only have names, call lookup_entities first to resolve buyer_org_id and supplier_org_id.',
    input_schema: {
      type: 'object',
      properties: {
        buyer_org_id: { type: 'string', description: 'UUID of the buying organization' },
        supplier_org_id: { type: 'string', description: 'UUID of the supplying organization' },
        deal_parameters: {
          type: 'object',
          description: 'The deal being evaluated',
          properties: {
            product_category: { type: 'string' },
            line_items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  quantity: { type: 'number' },
                  unit: { type: 'string' },
                  unit_price: { type: 'number' },
                  specs: { type: 'object' },
                },
              },
            },
            total_deal_value: { type: 'number' },
            currency: { type: 'string', default: 'USD' },
            required_delivery_date: { type: 'string', format: 'date' },
            delivery_location: { type: 'string' },
            payment_terms_days: { type: 'number', description: 'e.g. 30, 60, 90' },
          },
        },
        look_back_months: {
          type: 'number',
          default: 12,
          description: 'How many months of historical deal data to benchmark against',
        },
      },
      required: ['buyer_org_id', 'supplier_org_id'],
    },
  },

  {
    name: 'get_pricing_insights',
    description:
      'Research pricing for a product or commodity using BOTH internal platform transaction data ' +
      '(comparable deals and listings) AND external market data (commodity indices like LME, CME, FAO, ' +
      'Reuters trade feeds). Returns a benchmark comparison, market trend analysis, and negotiation tactics.',
    input_schema: {
      type: 'object',
      properties: {
        product_name: { type: 'string', description: 'Name of the product or commodity' },
        product_category: { type: 'string', description: 'Category for benchmarking (e.g. "Steel", "Copper", "Agricultural")' },
        specs: { type: 'object', description: 'Product specifications for better matching' },
        quantity: { type: 'number' },
        unit: { type: 'string', default: 'units' },
        proposed_unit_price: { type: 'number', description: 'The price under negotiation' },
        currency: { type: 'string', default: 'USD' },
        buyer_org_id: { type: 'string', description: 'UUID of buyer (optional, for personalized context)' },
        supplier_org_id: { type: 'string', description: 'UUID of supplier (optional)' },
        delivery_location: { type: 'string' },
        look_back_months: { type: 'number', default: 6 },
      },
      required: ['product_name'],
    },
  },

  {
    name: 'summarize_deal_negotiation',
    description:
      'Summarize the full negotiation history for a deal: room messages, deal events, amendments, ' +
      'and current status. Returns a structured timeline, key decisions made, open issues, and suggested next steps. ' +
      'If you only have a counterparty name, call lookup_entities({entity_type:"deal",...}) first to get the deal_id.',
    input_schema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'UUID of the deal' },
        include_room_messages: {
          type: 'boolean',
          default: true,
          description: 'Include Strike Room message history',
        },
        max_messages: { type: 'number', default: 100, description: 'Max room messages to include' },
      },
      required: ['deal_id'],
    },
  },

  {
    name: 'score_and_rank_financing_offers',
    description:
      'Score and rank all bank financing offers on a financing request based on the requester\'s priority. ' +
      'Evaluates rate, amount, tenor, structure type, and bank reputation. ' +
      'Writes ai_score and ai_score_reasoning back to financing_request_offers for each offer. ' +
      'If you don\'t have the financing_request_id, call lookup_entities({entity_type:"financing_request", query:"all", org_id}) first.',
    input_schema: {
      type: 'object',
      properties: {
        financing_request_id: { type: 'string', description: 'UUID of the financing_requests row' },
        priority: {
          type: 'string',
          enum: ['lowest_cost', 'fastest_funding', 'most_flexible', 'balanced'],
          description: 'What the requester values most',
        },
        requesting_org_id: {
          type: 'string',
          description: 'UUID of the requesting org (for context/personalization)',
        },
      },
      required: ['financing_request_id', 'priority'],
    },
  },

  {
    name: 'detect_deal_risk_signals',
    description:
      'Scan a deal and both counterparties for risk signals: document fraud flags, organization risk flags, ' +
      'tariff exposure, payment instruction anomalies, suspicious status history, and supply chain concentration risk. ' +
      'Returns a prioritized list of risk signals with severity and recommended actions. ' +
      'If you only have a counterparty name, call lookup_entities({entity_type:"deal",...}) first to get the deal_id.',
    input_schema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'UUID of the deal to scan' },
        org_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional org UUIDs to scan beyond the deal parties (optional)',
        },
        include_document_scan: {
          type: 'boolean',
          default: true,
          description: 'Include AI fraud scores from uploaded documents',
        },
      },
      required: ['deal_id'],
    },
  },

  {
    name: 'recommend_suppliers_for_buyer',
    description:
      'Search the Strike network for the best-matched suppliers for a buyer\'s specific need. ' +
      'Ranks by product match, location proximity, Passport score, on-time delivery rate, pricing, and capacity.',
    input_schema: {
      type: 'object',
      properties: {
        buyer_org_id: { type: 'string', description: 'UUID of the buying organization' },
        product_category: { type: 'string', description: 'What the buyer needs' },
        product_name: { type: 'string', description: 'More specific product name (optional)' },
        quantity: { type: 'number' },
        unit: { type: 'string' },
        delivery_location: { type: 'string', description: 'Where delivery is needed' },
        required_delivery_date: { type: 'string', format: 'date' },
        budget_per_unit: { type: 'number', description: 'Max price per unit' },
        currency: { type: 'string', default: 'USD' },
        min_passport_score: {
          type: 'number',
          default: 0,
          description: 'Minimum PassportScore to filter candidates (0-100)',
        },
        limit: { type: 'number', default: 5, description: 'Max number of recommendations to return' },
      },
      required: ['buyer_org_id', 'product_category'],
    },
  },

  {
    name: 'generate_deal_term_sheet',
    description:
      'Generate a structured term sheet for a deal including parties, goods, pricing, delivery terms, ' +
      'payment structure, financing details (if applicable), and key milestones. ' +
      'Pulls all data from the deal, line items, organizations, and linked financing request. ' +
      'If you only have a counterparty name, call lookup_entities({entity_type:"deal",...}) first to get the deal_id.',
    input_schema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'UUID of the deal' },
        include_financing: {
          type: 'boolean',
          default: true,
          description: 'Include financing terms if a financing request is linked',
        },
      },
      required: ['deal_id'],
    },
  },

  {
    name: 'evaluate_listing_offers',
    description:
      'Evaluate and rank all active offers on a marketplace listing. ' +
      'Scores each offer by price, delivery speed, and counterparty trustworthiness (PassportScore, KYB, performance). ' +
      'Returns a ranked list with AI reasoning and a clear top recommendation. ' +
      'Use this when a user asks "which offer should I accept?" or "which offer is best?". ' +
      'If you only have a listing title, call lookup_entities first to get the listing_id.',
    input_schema: {
      type: 'object',
      properties: {
        listing_id: { type: 'string', description: 'UUID of the marketplace listing' },
        priority: {
          type: 'string',
          enum: ['best_price', 'fastest_delivery', 'strongest_counterparty', 'balanced'],
          description: 'What the poster values most. Defaults to balanced.',
        },
      },
      required: ['listing_id'],
    },
  },

  {
    name: 'get_passport_advice',
    description:
      'Generate personalized AI advice about an organization\'s PassportScore: ' +
      'where they stand, what\'s driving the score up or down, specific actions to improve it, ' +
      'and what the estimated score uplift would be. ' +
      'Use this when a user asks "how is my passport?", "how do I improve my score?", or anything about their PassportScore.',
    input_schema: {
      type: 'object',
      properties: {
        org_id: { type: 'string', description: 'UUID of the organization. Use the org_id from context.' },
      },
      required: ['org_id'],
    },
  },

  {
    name: 'proactive_portfolio_alerts',
    description:
      'Scan a bank\'s full portfolio for issues requiring attention: overdue payments, stuck deals, ' +
      'deteriorating supplier performance, concentration risk, high-risk flag changes, and upcoming maturities. ' +
      'Returns a prioritized alert list. Intended for bank users only.',
    input_schema: {
      type: 'object',
      properties: {
        bank_id: { type: 'string', description: 'UUID of the bank' },
        alert_types: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'overdue_payments',
              'stuck_deals',
              'deteriorating_performance',
              'high_risk_flags',
              'upcoming_maturities',
              'concentration_risk',
            ],
          },
          description: 'Alert categories to scan. Defaults to all.',
        },
        days_horizon: {
          type: 'number',
          default: 30,
          description: 'Look-ahead window in days for upcoming maturities',
        },
      },
      required: ['bank_id'],
    },
  },

  {
    name: 'get_active_deals',
    description:
      'List all active (non-completed, non-cancelled) deals for an organization. ' +
      'Use this whenever the user asks about their current deals, deal status, what\'s in progress, ' +
      'payment due dates, or wants a deals summary. Pass the org_id from the user identity in context.',
    input_schema: {
      type: 'object',
      properties: {
        org_id: { type: 'string', description: 'UUID of the organization whose deals to fetch' },
        status_filter: {
          type: 'string',
          enum: ['all', 'active_only', 'payment_due', 'needs_action'],
          description: 'all = everything active; active_only = excludes payment-related; payment_due = overdue/due; needs_action = stages requiring the user to act',
        },
      },
      required: ['org_id'],
    },
  },
] as const
