import { adminClient } from '../admin'

type Section =
  | 'business_profile'
  | 'kyb_compliance'
  | 'financial_health'
  | 'platform_history'
  | 'peer_reviews'
  | 'performance_metrics'
  | 'risk_flags'
  | 'financing_behavior'
  | 'supply_chain_footprint'

export interface EvaluateSupplierPassportInput {
  supplier_org_id: string
  requesting_org_id?: string
  evaluation_purpose: string
  include_sections?: Section[]
}

const DEFAULT_SECTIONS: Section[] = [
  'business_profile',
  'kyb_compliance',
  'financial_health',
  'platform_history',
  'peer_reviews',
  'performance_metrics',
  'risk_flags',
  'financing_behavior',
]

function kybStatusScore(status: string | null): number {
  const map: Record<string, number> = {
    approved: 100, under_review: 70, submitted: 60,
    more_info_requested: 40, in_progress: 25, not_started: 0, rejected: 0,
  }
  return map[status ?? 'not_started'] ?? 0
}

function revenueRangeScore(range: string | null): number {
  if (!range) return 20
  if (range.includes('100M') || range.includes('1B') || range.includes('+')) return 100
  if (range.includes('50M')) return 85
  if (range.includes('25M') || range.includes('10M')) return 65
  if (range.includes('5M') || range.includes('1M')) return 40
  return 20
}

export async function evaluateSupplierPassport(input: EvaluateSupplierPassportInput) {
  const sections = input.include_sections ?? DEFAULT_SECTIONS
  const orgId = input.supplier_org_id

  const { data: org } = await adminClient
    .from('organizations')
    .select(
      'id, type, legal_name, doing_business_as, ein, business_type, state_of_incorporation, ' +
      'country_of_incorporation, industry_naics, website, description, ' +
      'city, state, country, ' +
      'years_in_operation, annual_revenue_range, employee_count_range, ' +
      'kyb_status, kyb_submitted_at, kyb_ai_reviewed_at, kyb_approved_at, kyb_rejection_reason, ' +
      'risk_score, risk_tier, risk_flags, tariff_exposure, ' +
      'credit_score, performance_score, performance_tier, ' +
      'network_visible, passport_score, passport_published_at, passport_narrative, ' +
      'trade_count_total, trade_volume_total, avg_payment_days, dispute_rate_network, ' +
      'banks_transacted_with, sourcing_countries, country_of_origin, product_categories, ' +
      'primary_bank_id, created_at'
    )
    .eq('id', orgId)
    .single()

  if (!org) return { error: `Organization ${orgId} not found` }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = {
    org_id: orgId,
    legal_name: org.legal_name,
    doing_business_as: org.doing_business_as,
    org_type: org.type,
    evaluation_purpose: input.evaluation_purpose,
    sections_evaluated: sections,
  }

  const sectionScores: Record<string, number> = {}

  if (sections.includes('business_profile')) {
    const yearsScore = Math.min(100, (org.years_in_operation ?? 0) * 5)
    const revScore = revenueRangeScore(org.annual_revenue_range)
    const sectionScore = Math.round((yearsScore + revScore) / 2)
    sectionScores.business_profile = sectionScore
    result.business_profile = {
      score: sectionScore,
      legal_name: org.legal_name,
      doing_business_as: org.doing_business_as,
      business_type: org.business_type,
      industry_naics: org.industry_naics,
      years_in_operation: org.years_in_operation,
      annual_revenue_range: org.annual_revenue_range,
      employee_count_range: org.employee_count_range,
      state_of_incorporation: org.state_of_incorporation,
      country_of_incorporation: org.country_of_incorporation,
      location: [org.city, org.state, org.country].filter(Boolean).join(', '),
      product_categories: org.product_categories,
      sourcing_countries: org.sourcing_countries,
      country_of_origin: org.country_of_origin,
      website: org.website,
    }
  }

  if (sections.includes('kyb_compliance')) {
    const { data: kybDocs } = await adminClient
      .from('documents')
      .select('id, document_kind, name, created_at, ai_extracted')
      .eq('entity_type', 'organization')
      .eq('entity_id', orgId)

    const kybScore = kybStatusScore(org.kyb_status)
    const docCompleteness = Math.min(100, ((kybDocs?.length ?? 0) / 5) * 100)
    const sectionScore = Math.round(kybScore * 0.7 + docCompleteness * 0.3)
    sectionScores.kyb_compliance = sectionScore
    result.kyb_compliance = {
      score: sectionScore,
      kyb_status: org.kyb_status,
      kyb_submitted_at: org.kyb_submitted_at,
      kyb_approved_at: org.kyb_approved_at,
      kyb_rejection_reason: org.kyb_rejection_reason,
      document_count: kybDocs?.length ?? 0,
      documents: (kybDocs ?? []).map((d: { document_kind: string; name: string; ai_extracted: boolean }) => ({
        kind: d.document_kind, name: d.name, ai_extracted: d.ai_extracted,
      })),
    }
  }

  if (sections.includes('financial_health')) {
    const [{ data: creditScore }, { data: financialDocs }] = await Promise.all([
      adminClient
        .from('credit_scores')
        .select(
          'total_score, score_business_longevity, score_revenue_scale, score_document_completeness, ' +
          'score_financial_health, score_program_fit, score_counterparty_tenure, ' +
          'risk_tier, financial_health_notes, created_at'
        )
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single(),
      adminClient
        .from('documents')
        .select('id, document_kind, name, created_at, ai_extraction, ai_fraud_score')
        .eq('entity_type', 'organization')
        .eq('entity_id', orgId)
        .in('document_kind', ['financials', 'bank_statement', 'tax_return', 'financial_statement']),
    ])

    const sectionScore = creditScore?.total_score ?? org.credit_score ?? 0
    sectionScores.financial_health = sectionScore
    result.financial_health = {
      score: sectionScore,
      credit_score_breakdown: creditScore ? {
        total: creditScore.total_score,
        business_longevity: creditScore.score_business_longevity,
        revenue_scale: creditScore.score_revenue_scale,
        document_completeness: creditScore.score_document_completeness,
        financial_health: creditScore.score_financial_health,
        program_fit: creditScore.score_program_fit,
        counterparty_tenure: creditScore.score_counterparty_tenure,
        risk_tier: creditScore.risk_tier,
        notes: creditScore.financial_health_notes,
        last_assessed: creditScore.created_at,
      } : null,
      financial_documents: (financialDocs ?? []).map((d: { document_kind: string; name: string; created_at: string; ai_extraction: unknown; ai_fraud_score: number }) => ({
        kind: d.document_kind,
        name: d.name,
        uploaded_at: d.created_at,
        ai_extracted: !!d.ai_extraction,
        fraud_score: d.ai_fraud_score,
      })),
    }
  }

  if (sections.includes('platform_history')) {
    const { data: deals } = await adminClient
      .from('deals')
      .select('id, status, deal_source, created_at, buyer_org_id, supplier_org_id')
      .or(`buyer_org_id.eq.${orgId},supplier_org_id.eq.${orgId}`)
      .order('created_at', { ascending: false })
      .limit(50)

    const completedDeals = (deals ?? []).filter((d: { status: string }) => d.status === 'completed')
    const activeDeals = (deals ?? []).filter((d: { status: string }) => !['completed', 'cancelled'].includes(d.status))
    const historyScore = Math.min(100, completedDeals.length * 10 + (org.trade_count_total ?? 0) * 2)
    sectionScores.platform_history = Math.min(100, historyScore)
    result.platform_history = {
      score: Math.min(100, historyScore),
      total_deals: deals?.length ?? 0,
      completed_deals: completedDeals.length,
      active_deals: activeDeals.length,
      trade_count_total: org.trade_count_total,
      trade_volume_total: org.trade_volume_total,
      avg_payment_days: org.avg_payment_days,
      dispute_rate_network: org.dispute_rate_network,
      member_since: org.created_at,
      recent_deals: (deals ?? []).slice(0, 5).map((d: { id: string; status: string; buyer_org_id: string; deal_source: string; created_at: string }) => ({
        id: d.id, status: d.status,
        role: d.buyer_org_id === orgId ? 'buyer' : 'supplier',
        source: d.deal_source, created_at: d.created_at,
      })),
    }
  }

  if (sections.includes('peer_reviews')) {
    const { data: reviews } = await adminClient
      .from('passport_peer_reviews')
      .select('id, reviewing_org_id, rating, category_scores, comment, created_at')
      .eq('reviewed_org_id', orgId)
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(20)

    const avgRating =
      (reviews ?? []).length > 0
        ? (reviews ?? []).reduce((sum: number, r: { rating: number }) => sum + r.rating, 0) / (reviews ?? []).length
        : null
    const sectionScore = avgRating ? Math.round((avgRating / 5) * 100) : 0
    sectionScores.peer_reviews = sectionScore
    result.peer_reviews = {
      score: sectionScore,
      review_count: reviews?.length ?? 0,
      average_rating: avgRating ? Math.round(avgRating * 10) / 10 : null,
      reviews: (reviews ?? []).slice(0, 5).map((r: { rating: number; comment: string; category_scores: unknown; created_at: string }) => ({
        rating: r.rating, comment: r.comment, category_scores: r.category_scores, date: r.created_at,
      })),
    }
  }

  if (sections.includes('performance_metrics')) {
    const { data: perf } = await adminClient
      .from('supplier_performance')
      .select(
        'on_time_payment_rate, dispute_rate, financing_utilization_rate, avg_advance_rate, ' +
        'total_transactions, total_financed, total_deals, total_deal_volume, ' +
        'performance_tier, performance_score, last_calculated_at'
      )
      .eq('org_id', orgId)
      .order('last_calculated_at', { ascending: false })
      .limit(1)
      .single()

    const sectionScore = perf?.performance_score ?? org.performance_score ?? 0
    sectionScores.performance_metrics = sectionScore
    result.performance_metrics = {
      score: sectionScore,
      on_time_payment_rate: perf?.on_time_payment_rate,
      dispute_rate: perf?.dispute_rate,
      financing_utilization_rate: perf?.financing_utilization_rate,
      avg_advance_rate: perf?.avg_advance_rate,
      total_transactions: perf?.total_transactions,
      total_financed: perf?.total_financed,
      total_deals: perf?.total_deals,
      total_deal_volume: perf?.total_deal_volume,
      performance_tier: perf?.performance_tier ?? org.performance_tier,
      last_calculated_at: perf?.last_calculated_at,
    }
  }

  if (sections.includes('risk_flags')) {
    const { data: flaggedDocs } = await adminClient
      .from('documents')
      .select('id, document_kind, name, ai_fraud_score, ai_fraud_flags')
      .eq('entity_type', 'organization')
      .eq('entity_id', orgId)
      .not('ai_fraud_score', 'is', null)

    const riskScore = 100 - (org.risk_score ?? 50)
    sectionScores.risk_flags = Math.max(0, riskScore)
    result.risk_flags = {
      score: Math.max(0, riskScore),
      org_risk_score: org.risk_score,
      org_risk_tier: org.risk_tier,
      risk_flags: org.risk_flags,
      tariff_exposure: org.tariff_exposure,
      flagged_documents: (flaggedDocs ?? [])
        .filter((d: { ai_fraud_score: number }) => (d.ai_fraud_score ?? 0) > 0.3)
        .map((d: { document_kind: string; name: string; ai_fraud_score: number; ai_fraud_flags: unknown }) => ({
          kind: d.document_kind, name: d.name,
          fraud_score: d.ai_fraud_score, flags: d.ai_fraud_flags,
        })),
    }
  }

  if (sections.includes('financing_behavior')) {
    const [{ data: finRequests }, { data: transactions }] = await Promise.all([
      adminClient
        .from('financing_requests')
        .select('id, status, created_at')
        .eq('requesting_org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(20),
      adminClient
        .from('transactions')
        .select('id, status, financing_amount_requested, financing_amount_approved, financing_rate_apr, repaid_at')
        .or(`anchor_id.eq.${orgId},supplier_id.eq.${orgId}`)
        .not('financing_amount_requested', 'is', null)
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    const repaidCount = (transactions ?? []).filter((t: { repaid_at: string | null }) => t.repaid_at).length
    const repaymentRate = (transactions ?? []).length > 0
      ? Math.round((repaidCount / (transactions ?? []).length) * 100)
      : null

    sectionScores.financing_behavior = repaymentRate ?? 50
    result.financing_behavior = {
      score: repaymentRate ?? 50,
      financing_requests_total: finRequests?.length ?? 0,
      transactions_with_financing: transactions?.length ?? 0,
      repayment_rate_pct: repaymentRate,
    }
  }

  if (sections.includes('supply_chain_footprint')) {
    const { data: edges } = await adminClient
      .from('supply_graph_edges')
      .select('id, from_org_id, to_org_id, edge_type, transaction_count, total_volume')
      .or(`from_org_id.eq.${orgId},to_org_id.eq.${orgId}`)
      .limit(30)

    sectionScores.supply_chain_footprint = 70
    result.supply_chain_footprint = {
      score: 70,
      network_connections: edges?.length ?? 0,
      banks_transacted_with: org.banks_transacted_with,
      sourcing_countries: org.sourcing_countries,
      product_categories: org.product_categories,
      edges: (edges ?? []).slice(0, 10),
    }
  }

  // Build a concise summary for Claude to reason over.
  // We omit raw arrays to keep the prompt tight; section objects contain the key stats.
  const summaryForClaude = {
    organization: {
      legal_name: org.legal_name,
      business_type: org.business_type,
      years_in_operation: org.years_in_operation,
      annual_revenue_range: org.annual_revenue_range,
      employee_count_range: org.employee_count_range,
      industry_naics: org.industry_naics,
      country: org.country,
      kyb_status: org.kyb_status,
      passport_score: org.passport_score,
      risk_score: org.risk_score,
      risk_tier: org.risk_tier,
      risk_flags: org.risk_flags,
      tariff_exposure: org.tariff_exposure,
      performance_score: org.performance_score,
      performance_tier: org.performance_tier,
      network_visible: org.network_visible,
    },
    sections: result,
    evaluation_purpose: input.evaluation_purpose,
  }

  // Ask Claude to reason over the data and produce a holistic score.
  // Falls back to the deterministic formula if the API call fails or returns invalid JSON.
  let overall_score = 0
  let recommendation = ''
  let recommendation_level = 'caution'
  let score_reasoning = ''
  let ai_scored = false

  try {
    const scoringPrompt = `You are a senior credit analyst at a supply chain finance platform evaluating a supplier's trustworthiness for trade and financing.

Below is structured data about this supplier gathered from the Strike SCF platform. Your task is to:

1. Assign an overall PassportScore from 0 to 100, where:
   - 80–100 = Highly trusted counterparty
   - 60–79  = Adequate, proceed with standard due diligence
   - 40–59  = Moderate risk, consider enhanced scrutiny
   - 0–39   = Elevated risk, caution or decline advised

2. Choose a recommendation_level: "proceed", "proceed_with_care", "caution", or "decline"

3. Write a 2–3 sentence professional recommendation for a CFO or Trade Finance officer

4. Explain the 3–5 most important factors that drove your score (positive and negative)

Supplier data:
${JSON.stringify(summaryForClaude, null, 2)}

Respond with ONLY valid JSON in this exact shape:
{
  "overall_score": <integer 0-100>,
  "recommendation_level": "<proceed|proceed_with_care|caution|decline>",
  "recommendation": "<2-3 sentence professional recommendation>",
  "score_reasoning": "<explanation of key factors>"
}`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        system: 'You are a supply chain finance credit analyst. Always respond with valid JSON only — no prose, no markdown fences.',
        messages: [{ role: 'user', content: scoringPrompt }],
      }),
    })

    if (res.ok) {
      const data = await res.json()
      const text: string = data?.content?.[0]?.text ?? ''

      // Strip any accidental markdown fences before parsing
      const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
      const parsed = JSON.parse(cleaned) as {
        overall_score: number
        recommendation_level: string
        recommendation: string
        score_reasoning: string
      }

      if (
        typeof parsed.overall_score === 'number' &&
        parsed.overall_score >= 0 &&
        parsed.overall_score <= 100 &&
        ['proceed', 'proceed_with_care', 'caution', 'decline'].includes(parsed.recommendation_level)
      ) {
        overall_score = Math.round(parsed.overall_score)
        recommendation_level = parsed.recommendation_level
        recommendation = parsed.recommendation
        score_reasoning = parsed.score_reasoning
        ai_scored = true

        // Write the AI-computed score + evaluation timestamp back to the org.
        // Fire-and-forget — never blocks the response.
        void adminClient
          .from('organizations')
          .update({
            passport_score: overall_score,
            passport_ai_evaluated_at: new Date().toISOString(),
          })
          .eq('id', orgId)
          .then(({ error: updateErr }: { error: unknown }) => {
            if (updateErr) console.error('[passport] score writeback error:', updateErr)
          })
      }
    }
  } catch {
    // Fall through to deterministic fallback below
  }

  // Deterministic fallback if Claude's call failed or returned invalid output.
  if (!ai_scored) {
    const weights: Record<Section, number> = {
      business_profile: 10, kyb_compliance: 20, financial_health: 20,
      platform_history: 15, peer_reviews: 10, performance_metrics: 15,
      risk_flags: 15, financing_behavior: 10, supply_chain_footprint: 5,
    }
    let totalWeight = 0
    let weightedSum = 0
    for (const [section, score] of Object.entries(sectionScores)) {
      const w = weights[section as Section] ?? 10
      weightedSum += score * w
      totalWeight += w
    }
    overall_score = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0
    score_reasoning = 'Scored using deterministic weighted formula (AI scoring unavailable).'

    if (overall_score >= 80) {
      recommendation = 'Strong counterparty — recommended to proceed with standard terms.'
      recommendation_level = 'proceed'
    } else if (overall_score >= 60) {
      recommendation = 'Adequate counterparty — proceed with standard due diligence.'
      recommendation_level = 'proceed_with_care'
    } else if (overall_score >= 40) {
      recommendation = 'Moderate risk — consider enhanced due diligence and tighter payment terms.'
      recommendation_level = 'caution'
    } else {
      recommendation = 'Elevated risk — recommend declining or requiring collateral and additional verification.'
      recommendation_level = 'decline'
    }
  }

  return {
    ...result,
    overall_score,
    section_scores: sectionScores,
    passport_score: org.passport_score,
    passport_published_at: org.passport_published_at,
    passport_narrative: org.passport_narrative,
    network_visible: org.network_visible,
    recommendation,
    recommendation_level,
    score_reasoning,
    ai_scored,
  }
}
