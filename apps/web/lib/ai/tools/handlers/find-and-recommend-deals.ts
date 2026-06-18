import { adminClient } from '../admin'

interface LineItem {
  name: string
  quantity?: number
  unit?: string
  unit_price?: number
  specs?: Record<string, unknown>
}

export interface FindAndRecommendDealsInput {
  buyer_org_id: string
  supplier_org_id: string
  deal_parameters?: {
    product_category?: string
    line_items?: LineItem[]
    total_deal_value?: number
    currency?: string
    required_delivery_date?: string
    delivery_location?: string
    payment_terms_days?: number
  }
  look_back_months?: number
}

function monthsAgo(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString()
}

export async function findAndRecommendDeals(input: FindAndRecommendDealsInput) {
  const lookBack = input.look_back_months ?? 12
  const since = monthsAgo(lookBack)
  const params = input.deal_parameters ?? {}

  const [{ data: buyer }, { data: supplier }, { data: supplierPerf }, { data: supplierReviews }] =
    await Promise.all([
      adminClient
        .from('organizations')
        .select(
          'id, legal_name, type, passport_score, product_categories, city, state, country, ' +
          'trade_count_total, avg_payment_days, kyb_status, risk_score, risk_tier'
        )
        .eq('id', input.buyer_org_id)
        .single(),
      adminClient
        .from('organizations')
        .select(
          'id, legal_name, type, passport_score, product_categories, city, state, country, ' +
          'trade_count_total, avg_payment_days, kyb_status, risk_score, risk_tier, ' +
          'years_in_operation, annual_revenue_range'
        )
        .eq('id', input.supplier_org_id)
        .single(),
      adminClient
        .from('supplier_performance')
        .select('on_time_payment_rate, dispute_rate, avg_advance_rate, performance_score, performance_tier, total_deals')
        .eq('org_id', input.supplier_org_id)
        .order('last_calculated_at', { ascending: false })
        .limit(1)
        .single(),
      adminClient
        .from('passport_peer_reviews')
        .select('rating, category_scores, comment')
        .eq('reviewed_org_id', input.supplier_org_id)
        .eq('is_public', true)
        .limit(10),
    ])

  if (!buyer) return { error: `Buyer org ${input.buyer_org_id} not found` }
  if (!supplier) return { error: `Supplier org ${input.supplier_org_id} not found` }

  const { data: priorDeals } = await adminClient
    .from('deals')
    .select('id, status, created_at, buyer_org_id, supplier_org_id')
    .or(
      `and(buyer_org_id.eq.${input.buyer_org_id},supplier_org_id.eq.${input.supplier_org_id}),` +
      `and(buyer_org_id.eq.${input.supplier_org_id},supplier_org_id.eq.${input.buyer_org_id})`
    )
    .gte('created_at', since)

  const { data: marketDeals } = params.product_category
    ? await adminClient.from('deals').select('id').gte('created_at', since).limit(50)
    : { data: [] }

  const scores: Record<string, number> = {}

  const supplierCategories: string[] = (supplier.product_categories as string[]) ?? []
  if (params.product_category && supplierCategories.length > 0) {
    const match = supplierCategories.some(
      (c: string) =>
        c.toLowerCase().includes(params.product_category!.toLowerCase()) ||
        params.product_category!.toLowerCase().includes(c.toLowerCase())
    )
    scores.product_match = match ? 90 : 30
  } else {
    scores.product_match = 60
  }

  if (params.required_delivery_date) {
    const daysUntilDelivery = (new Date(params.required_delivery_date).getTime() - Date.now()) / 86400000
    const onTime = (supplierPerf?.on_time_payment_rate ?? 0.7) * 100
    scores.delivery_feasibility = daysUntilDelivery >= 14 ? onTime : Math.max(0, onTime - 20)
  } else {
    scores.delivery_feasibility = (supplierPerf?.on_time_payment_rate ?? 0.7) * 100
  }

  scores.pricing = (marketDeals?.length ?? 0) > 3 ? 72 : 70

  if (params.delivery_location && supplier.city) {
    const locationMatch =
      params.delivery_location.toLowerCase().includes(supplier.city.toLowerCase()) ||
      params.delivery_location.toLowerCase().includes((supplier.state ?? '').toLowerCase())
    scores.location = locationMatch ? 95 : 55
  } else {
    scores.location = 65
  }

  scores.passport_quality = Math.round(((buyer.passport_score ?? 50) + (supplier.passport_score ?? 50)) / 2)

  const completedPrior = (priorDeals ?? []).filter((d: { status: string }) => d.status === 'completed').length
  scores.relationship = Math.min(100, 40 + completedPrior * 20)

  scores.risk_alignment = Math.max(0, 100 - ((buyer.risk_score ?? 50) + (supplier.risk_score ?? 50)) / 2)

  const overall = Math.round(
    scores.product_match * 0.25 +
    scores.delivery_feasibility * 0.2 +
    scores.pricing * 0.1 +
    scores.location * 0.1 +
    scores.passport_quality * 0.15 +
    scores.relationship * 0.1 +
    scores.risk_alignment * 0.1
  )

  let recommendation: string
  let verdict: string
  if (overall >= 75) {
    verdict = 'recommended'
    recommendation = 'This deal looks well-matched. Both parties align on product, delivery, and trust signals. Proceed.'
  } else if (overall >= 55) {
    verdict = 'proceed_with_diligence'
    recommendation = 'Reasonable match with some gaps. Review flagged dimensions before committing.'
  } else if (overall >= 35) {
    verdict = 'caution'
    recommendation = 'Several mismatches. Consider a smaller pilot deal first.'
  } else {
    verdict = 'not_recommended'
    recommendation = 'Significant mismatches or risks. Do not proceed without resolution.'
  }

  const avgRating =
    (supplierReviews?.length ?? 0) > 0
      ? (supplierReviews ?? []).reduce((s: number, r: { rating: number }) => s + r.rating, 0) / (supplierReviews ?? []).length
      : null

  const suggestedPaymentTerms = params.payment_terms_days ??
    Math.min(60, Math.max(30, Math.round(((buyer.avg_payment_days ?? 45) + (supplier.avg_payment_days ?? 45)) / 2)))

  return {
    verdict,
    overall_score: overall,
    recommendation,
    score_breakdown: scores,
    parties: {
      buyer: {
        id: buyer.id, legal_name: buyer.legal_name,
        passport_score: buyer.passport_score, kyb_status: buyer.kyb_status,
        risk_tier: buyer.risk_tier, avg_payment_days: buyer.avg_payment_days,
        location: [buyer.city, buyer.state, buyer.country].filter(Boolean).join(', '),
      },
      supplier: {
        id: supplier.id, legal_name: supplier.legal_name,
        passport_score: supplier.passport_score, kyb_status: supplier.kyb_status,
        risk_tier: supplier.risk_tier, years_in_operation: supplier.years_in_operation,
        annual_revenue_range: supplier.annual_revenue_range,
        product_categories: supplier.product_categories,
        on_time_payment_rate: supplierPerf?.on_time_payment_rate,
        dispute_rate: supplierPerf?.dispute_rate,
        performance_tier: supplierPerf?.performance_tier,
        avg_peer_rating: avgRating ? Math.round(avgRating * 10) / 10 : null,
        location: [supplier.city, supplier.state, supplier.country].filter(Boolean).join(', '),
      },
    },
    prior_deals: {
      total: priorDeals?.length ?? 0,
      completed: (priorDeals ?? []).filter((d: { status: string }) => d.status === 'completed').length,
    },
    suggested_terms: {
      payment_terms_days: suggestedPaymentTerms,
      currency: params.currency ?? 'USD',
      delivery_location: params.delivery_location ?? null,
    },
    market_context: { comparable_deals_found: marketDeals?.length ?? 0, look_back_months: lookBack },
  }
}
