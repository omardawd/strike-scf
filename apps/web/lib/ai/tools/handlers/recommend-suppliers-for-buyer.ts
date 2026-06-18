import { adminClient } from '../admin'

export interface RecommendSuppliersForBuyerInput {
  buyer_org_id: string
  product_category: string
  product_name?: string
  quantity?: number
  unit?: string
  delivery_location?: string
  required_delivery_date?: string
  budget_per_unit?: number
  currency?: string
  min_passport_score?: number
  limit?: number
}

export async function recommendSuppliersForBuyer(input: RecommendSuppliersForBuyerInput) {
  const limit = Math.min(input.limit ?? 5, 10)
  const minPassport = input.min_passport_score ?? 0

  const { data: buyer } = await adminClient
    .from('organizations')
    .select('id, legal_name, city, state, country')
    .eq('id', input.buyer_org_id)
    .single()

  const { data: candidateOrgs } = await adminClient
    .from('organizations')
    .select(
      'id, legal_name, doing_business_as, city, state, country, ' +
      'passport_score, product_categories, kyb_status, risk_score, risk_tier, ' +
      'years_in_operation, annual_revenue_range, trade_count_total, avg_payment_days, network_visible'
    )
    .eq('type', 'supplier')
    .eq('network_visible', true)
    .in('kyb_status', ['approved', 'submitted', 'under_review'])
    .gte('passport_score', minPassport)
    .limit(100)

  if (!candidateOrgs || candidateOrgs.length === 0) {
    return {
      buyer_id: input.buyer_org_id,
      product_category: input.product_category,
      recommendations: [],
      message: 'No eligible suppliers found in the network for this category.',
    }
  }

  const candidateIds = candidateOrgs.map((o: { id: string }) => o.id)

  const [{ data: perfRecords }, { data: listings }, { data: reviews }] = await Promise.all([
    adminClient
      .from('supplier_performance')
      .select('org_id, on_time_payment_rate, dispute_rate, performance_score, performance_tier, total_deals')
      .in('org_id', candidateIds),
    adminClient
      .from('marketplace_listings')
      .select('org_id, listing_type, category, title, delivery_location, status')
      .in('org_id', candidateIds)
      .eq('status', 'active')
      .eq('listing_type', 'product_service'),
    adminClient
      .from('passport_peer_reviews')
      .select('reviewed_org_id, rating')
      .in('reviewed_org_id', candidateIds)
      .eq('is_public', true),
  ])

  const perfMap = Object.fromEntries((perfRecords ?? []).map((p: { org_id: string }) => [p.org_id, p]))
  const listingsMap: Record<string, { category: string | null; delivery_location: string | null }[]> = {}
  for (const l of listings ?? []) {
    if (!listingsMap[l.org_id]) listingsMap[l.org_id] = []
    listingsMap[l.org_id]!.push(l)
  }
  const reviewsMap: Record<string, number[]> = {}
  for (const r of reviews ?? []) {
    if (!reviewsMap[r.reviewed_org_id]) reviewsMap[r.reviewed_org_id] = []
    reviewsMap[r.reviewed_org_id]!.push(r.rating)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scored = candidateOrgs.map((org: any) => {
    const perf = perfMap[org.id]
    const orgListings = listingsMap[org.id] ?? []
    const orgRatings = reviewsMap[org.id] ?? []
    const avgRating = orgRatings.length > 0 ? orgRatings.reduce((a: number, b: number) => a + b, 0) / orgRatings.length : null

    const categories: string[] = (org.product_categories as string[]) ?? []
    const categoryMatch = categories.some(
      (c: string) =>
        c.toLowerCase().includes(input.product_category.toLowerCase()) ||
        input.product_category.toLowerCase().includes(c.toLowerCase())
    )
    const listingCategoryMatch = orgListings.some(
      (l) => l.category?.toLowerCase().includes(input.product_category.toLowerCase())
    )
    const productScore = categoryMatch || listingCategoryMatch ? 90 : 35

    let locationScore = 55
    if (input.delivery_location && org.city) {
      const loc = input.delivery_location.toLowerCase()
      if (loc.includes(org.city.toLowerCase()) || loc.includes((org.state ?? '').toLowerCase())) {
        locationScore = 95
      } else if (org.country === 'US' && loc.includes('us')) {
        locationScore = 70
      }
    }
    if (orgListings.some((l) => l.delivery_location?.toLowerCase().includes((input.delivery_location ?? '').toLowerCase()))) {
      locationScore = Math.max(locationScore, 80)
    }

    const passportScore = org.passport_score ?? 50
    const onTimeRate = (perf?.on_time_payment_rate ?? 0.7) * 100

    let deliveryScore = onTimeRate
    if (input.required_delivery_date) {
      const daysUntil = (new Date(input.required_delivery_date).getTime() - Date.now()) / 86400000
      if (daysUntil < 7) deliveryScore = onTimeRate * 0.5
      else if (daysUntil < 14) deliveryScore = onTimeRate * 0.8
    }

    const experienceScore = Math.min(100, (org.years_in_operation ?? 0) * 5 + (perf?.total_deals ?? 0) * 2)
    const peerScore = avgRating ? Math.round((avgRating / 5) * 100) : 60

    const overall = Math.round(
      productScore * 0.30 +
      passportScore * 0.20 +
      deliveryScore * 0.15 +
      locationScore * 0.15 +
      peerScore * 0.10 +
      experienceScore * 0.10
    )

    return {
      org_id: org.id,
      legal_name: org.legal_name,
      doing_business_as: org.doing_business_as,
      location: [org.city, org.state, org.country].filter(Boolean).join(', '),
      passport_score: passportScore,
      kyb_status: org.kyb_status,
      risk_tier: org.risk_tier,
      years_in_operation: org.years_in_operation,
      annual_revenue_range: org.annual_revenue_range,
      product_categories: categories,
      on_time_payment_rate: perf?.on_time_payment_rate,
      performance_tier: perf?.performance_tier,
      completed_deals: perf?.total_deals,
      avg_peer_rating: avgRating ? Math.round(avgRating * 10) / 10 : null,
      review_count: orgRatings.length,
      active_listings: orgListings.length,
      score: overall,
      score_breakdown: {
        product_match: productScore,
        passport: passportScore,
        delivery_feasibility: Math.round(deliveryScore),
        location: locationScore,
        peer_rating: peerScore,
        experience: Math.round(experienceScore),
      },
      why_recommended: [
        categoryMatch || listingCategoryMatch ? `Matches "${input.product_category}" category` : null,
        passportScore >= 70 ? `Strong Passport score (${passportScore})` : null,
        (perf?.on_time_payment_rate ?? 0) >= 0.9 ? `${Math.round((perf.on_time_payment_rate) * 100)}% on-time rate` : null,
        orgListings.length > 0 ? `${orgListings.length} active listing(s)` : null,
      ].filter(Boolean) as string[],
    }
  })

  scored.sort((a: { score: number }, b: { score: number }) => b.score - a.score)
  const recommendations = scored.slice(0, limit)

  return {
    buyer_id: input.buyer_org_id,
    buyer_name: buyer?.legal_name,
    search_criteria: {
      product_category: input.product_category,
      product_name: input.product_name,
      quantity: input.quantity,
      unit: input.unit,
      delivery_location: input.delivery_location,
      required_delivery_date: input.required_delivery_date,
      budget_per_unit: input.budget_per_unit,
      currency: input.currency ?? 'USD',
      min_passport_score: minPassport,
    },
    candidates_evaluated: candidateOrgs.length,
    recommendations,
    top_recommendation: recommendations[0] ?? null,
  }
}
