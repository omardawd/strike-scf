import { adminClient } from '../admin'

export interface EvaluateListingOffersInput {
  listing_id: string
  poster_org_id?: string  // provided from context; used to confirm ownership
  priority?: 'best_price' | 'fastest_delivery' | 'strongest_counterparty' | 'balanced'
}

export async function evaluateListingOffers(input: EvaluateListingOffersInput) {
  const priority = input.priority ?? 'balanced'

  const [{ data: listing }, { data: offers }] = await Promise.all([
    adminClient
      .from('marketplace_listings')
      .select(
        'id, title, listing_type, status, target_price, currency, ' +
        'delivery_date, delivery_location, org_id, created_at'
      )
      .eq('id', input.listing_id)
      .single(),
    adminClient
      .from('marketplace_offers')
      .select(
        'id, org_id, offered_price, offered_quantity, proposed_delivery_date, ' +
        'proposed_incoterms, proposed_payment_terms, shipping_cost, notes, ' +
        'offer_items, status, created_at'
      )
      .eq('listing_id', input.listing_id)
      .not('status', 'in', '("withdrawn","rejected","expired")')
      .order('created_at', { ascending: true }),
  ])

  if (!listing) return { error: `Listing ${input.listing_id} not found` }
  if (!offers || offers.length === 0) {
    return { listing_id: input.listing_id, message: 'No active offers to evaluate yet.' }
  }

  // Fetch each offeror org's profile and passport in parallel
  const offerorIds = [...new Set(offers.map((o: { org_id: string }) => o.org_id))]
  const { data: orgs } = await adminClient
    .from('organizations')
    .select(
      'id, legal_name, doing_business_as, type, kyb_status, passport_score, ' +
      'risk_score, risk_tier, performance_score, performance_tier, ' +
      'years_in_operation, annual_revenue_range, country'
    )
    .in('id', offerorIds)

  const orgMap = Object.fromEntries(
    (orgs ?? []).map((o: { id: string }) => [o.id, o])
  )

  // Build a compact summary for Claude to reason over
  const offerSummaries = offers.map((o: {
    id: string; org_id: string; offered_price: number; offered_quantity: number | null;
    proposed_delivery_date: string | null; proposed_incoterms: string | null;
    proposed_payment_terms: string | null; shipping_cost: number | null;
    notes: string | null; offer_items: unknown; status: string;
  }) => {
    const org = orgMap[o.org_id] ?? {}
    return {
      offer_id: o.id,
      offeror: {
        org_id: o.org_id,
        name: (org as { doing_business_as?: string; legal_name?: string }).doing_business_as
          ?? (org as { legal_name?: string }).legal_name ?? o.org_id,
        kyb_status: (org as { kyb_status?: string }).kyb_status,
        passport_score: (org as { passport_score?: number }).passport_score,
        risk_tier: (org as { risk_tier?: string }).risk_tier,
        performance_tier: (org as { performance_tier?: string }).performance_tier,
        years_in_operation: (org as { years_in_operation?: number }).years_in_operation,
        annual_revenue_range: (org as { annual_revenue_range?: string }).annual_revenue_range,
        country: (org as { country?: string }).country,
      },
      offered_price: o.offered_price,
      offered_quantity: o.offered_quantity,
      shipping_cost: o.shipping_cost,
      total_landed_cost: o.shipping_cost != null
        ? Number(o.offered_price) + Number(o.shipping_cost)
        : Number(o.offered_price),
      proposed_delivery_date: o.proposed_delivery_date,
      proposed_incoterms: o.proposed_incoterms,
      proposed_payment_terms: o.proposed_payment_terms,
      notes: o.notes,
      status: o.status,
    }
  })

  const listingSummary = {
    title: listing.title,
    listing_type: listing.listing_type,
    target_price: listing.target_price,
    currency: listing.currency,
    required_delivery_date: listing.delivery_date,
    delivery_location: listing.delivery_location,
  }

  const scoringPrompt = `You are a senior procurement advisor on Strike SCF evaluating offers received on a marketplace listing.

Listing:
${JSON.stringify(listingSummary, null, 2)}

Offers received (${offerSummaries.length}):
${JSON.stringify(offerSummaries, null, 2)}

Buyer's priority: ${priority}
- best_price: minimize total landed cost
- fastest_delivery: minimize time to delivery
- strongest_counterparty: maximize counterparty trust (passport score, kyb status, performance)
- balanced: equal weight across price, delivery, and counterparty quality

Your task:
1. Rank the offers from best to worst based on the priority above
2. For each offer explain in 1-2 sentences WHY it ranks where it does (specific numbers)
3. Give a clear TOP RECOMMENDATION with reasoning
4. Flag any red flags (e.g. poor passport score, unverified counterparty, aggressive pricing that seems too good)

Respond ONLY with valid JSON:
{
  "ranked_offers": [
    {
      "rank": 1,
      "offer_id": "<uuid>",
      "offeror_name": "<name>",
      "total_landed_cost": <number>,
      "score": <0-100>,
      "reasoning": "<1-2 sentences>",
      "red_flags": ["<flag>"] or []
    }
  ],
  "top_recommendation": {
    "offer_id": "<uuid>",
    "offeror_name": "<name>",
    "summary": "<2-3 sentence recommendation>"
  },
  "overall_assessment": "<brief market context or advice>"
}`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: 'You are a procurement advisor. Always respond with valid JSON only — no prose, no markdown fences.',
        messages: [{ role: 'user', content: scoringPrompt }],
      }),
    })

    if (res.ok) {
      const data = await res.json()
      const text: string = data?.content?.[0]?.text ?? ''
      const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
      const parsed = JSON.parse(cleaned)

      return {
        listing_id: input.listing_id,
        listing_title: listing.title,
        offer_count: offers.length,
        priority,
        currency: listing.currency,
        ...parsed,
        raw_offers: offerSummaries,
      }
    }
  } catch {
    // Fall through to basic summary
  }

  // Fallback: sort by total landed cost
  const sorted = [...offerSummaries].sort((a, b) => a.total_landed_cost - b.total_landed_cost)
  return {
    listing_id: input.listing_id,
    listing_title: listing.title,
    offer_count: offers.length,
    priority,
    currency: listing.currency,
    ranked_offers: sorted.map((o, i) => ({
      rank: i + 1,
      offer_id: o.offer_id,
      offeror_name: o.offeror.name,
      total_landed_cost: o.total_landed_cost,
      reasoning: 'Ranked by total landed cost (AI scoring unavailable)',
      red_flags: [],
    })),
    raw_offers: offerSummaries,
    ai_scored: false,
  }
}
