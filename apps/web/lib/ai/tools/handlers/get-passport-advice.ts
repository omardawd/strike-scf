import { adminClient } from '../admin'

export interface GetPassportAdviceInput {
  org_id: string
}

export async function getPassportAdvice(input: GetPassportAdviceInput) {
  const [
    { data: org },
    { data: perf },
    { data: reviews },
    { data: deals },
    { data: docs },
    { data: finRequests },
  ] = await Promise.all([
    adminClient
      .from('organizations')
      .select(
        'id, legal_name, doing_business_as, type, kyb_status, kyb_submitted_at, ' +
        'passport_score, passport_narrative, network_visible, ' +
        'risk_score, risk_tier, risk_flags, ' +
        'years_in_operation, annual_revenue_range, employee_count_range, ' +
        'credit_score, performance_score, performance_tier, ' +
        'sourcing_countries, country_of_origin, product_categories, ' +
        'created_at'
      )
      .eq('id', input.org_id)
      .single(),
    adminClient
      .from('supplier_performance')
      .select('on_time_payment_rate, dispute_rate, total_transactions, total_financed, performance_score, performance_tier')
      .eq('org_id', input.org_id)
      .order('last_calculated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    adminClient
      .from('passport_peer_reviews')
      .select('rating, comment, created_at')
      .eq('reviewed_org_id', input.org_id)
      .eq('is_public', true)
      .limit(10),
    adminClient
      .from('deals')
      .select('id, status, created_at')
      .or(`buyer_org_id.eq.${input.org_id},supplier_org_id.eq.${input.org_id}`)
      .order('created_at', { ascending: false })
      .limit(50),
    adminClient
      .from('documents')
      .select('id, document_kind, name, created_at')
      .eq('entity_type', 'organization')
      .eq('entity_id', input.org_id),
    adminClient
      .from('financing_requests')
      .select('id, status, created_at')
      .eq('requesting_org_id', input.org_id)
      .limit(10),
  ])

  if (!org) return { error: `Organization ${input.org_id} not found` }

  const completedDeals = (deals ?? []).filter((d: { status: string }) => d.status === 'completed')
  const activeDeals = (deals ?? []).filter((d: { status: string }) =>
    !['completed', 'cancelled'].includes(d.status)
  )

  const docKinds = (docs ?? []).map((d: { document_kind: string }) => d.document_kind)
  const hasFinancials = docKinds.some((k: string) => ['financials', 'bank_statement', 'tax_return', 'financial_statement'].includes(k))
  const hasCertifications = docKinds.some((k: string) => ['certification', 'license', 'iso', 'compliance'].includes(k))

  const avgRating = (reviews ?? []).length > 0
    ? (reviews ?? []).reduce((s: number, r: { rating: number }) => s + Number(r.rating), 0) / (reviews ?? []).length
    : null

  const snapshot = {
    org_name: org.doing_business_as ?? org.legal_name,
    org_type: org.type,
    passport_score: org.passport_score,
    kyb_status: org.kyb_status,
    kyb_submitted: !!org.kyb_submitted_at,
    network_visible: org.network_visible,
    years_in_operation: org.years_in_operation,
    annual_revenue_range: org.annual_revenue_range,
    employee_count_range: org.employee_count_range,
    product_categories: org.product_categories,
    risk_tier: org.risk_tier,
    risk_flags: org.risk_flags,
    performance_score: perf?.performance_score ?? org.performance_score,
    performance_tier: perf?.performance_tier ?? org.performance_tier,
    on_time_payment_rate: perf?.on_time_payment_rate,
    dispute_rate: perf?.dispute_rate,
    total_transactions: perf?.total_transactions ?? 0,
    completed_deals: completedDeals.length,
    active_deals: activeDeals.length,
    peer_review_count: (reviews ?? []).length,
    peer_review_avg: avgRating,
    document_count: (docs ?? []).length,
    has_financial_documents: hasFinancials,
    has_certifications: hasCertifications,
    document_kinds_uploaded: [...new Set(docKinds)],
    financing_requests: (finRequests ?? []).length,
    member_since: org.created_at,
  }

  const advicePrompt = `You are Strike AI giving a user personalized feedback about their Strike SCF PassportScore.

The PassportScore (0-100) reflects how trustworthy and creditworthy a counterparty appears to the network.
- 80-100: Highly trusted — top-tier counterparty
- 60-79:  Solid — good standing, proceed with standard diligence
- 40-59:  Moderate — gaps that need addressing
- 0-39:   Weak — significant credibility gaps

Here is this organization's current data:
${JSON.stringify(snapshot, null, 2)}

Write a personalized, direct assessment for the org admin. Include:
1. A plain-English summary of where they stand and what the score means
2. Their 2-3 main STRENGTHS (what's driving the score up)
3. Their 2-3 main GAPS (what's holding the score back), each with a specific action they can take
4. An overall priority recommendation (the single highest-impact thing they should do next)

Tone: honest, direct, encouraging — like a trusted advisor, not a robot. CFO/trade finance audience.

Respond ONLY with valid JSON:
{
  "score": <number>,
  "score_label": "<Highly Trusted|Solid|Moderate|Needs Work>",
  "summary": "<2-3 sentence plain-English where-you-stand>",
  "strengths": [
    { "title": "<short title>", "detail": "<1 sentence>" }
  ],
  "gaps": [
    { "title": "<short title>", "detail": "<1 sentence>", "action": "<specific thing to do>" }
  ],
  "top_priority": "<single most important next action>",
  "estimated_score_uplift": "<e.g. '+8-12 points'>"
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
        max_tokens: 800,
        system: 'You are Strike AI. Always respond with valid JSON only — no prose, no markdown fences.',
        messages: [{ role: 'user', content: advicePrompt }],
      }),
    })

    if (res.ok) {
      const data = await res.json()
      const text: string = data?.content?.[0]?.text ?? ''
      const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
      const parsed = JSON.parse(cleaned)

      return {
        org_id: input.org_id,
        org_name: snapshot.org_name,
        passport_score: org.passport_score,
        advice: parsed,
        snapshot,
        generated_at: new Date().toISOString(),
      }
    }
  } catch {
    // Fall through
  }

  // Minimal fallback
  const score = org.passport_score ?? 0
  return {
    org_id: input.org_id,
    org_name: snapshot.org_name,
    passport_score: score,
    advice: {
      score,
      score_label: score >= 80 ? 'Highly Trusted' : score >= 60 ? 'Solid' : score >= 40 ? 'Moderate' : 'Needs Work',
      summary: `Your PassportScore is ${score}/100. Complete your KYB verification and upload financial documents to improve it.`,
      strengths: [],
      gaps: [
        { title: 'KYB not fully verified', detail: 'KYB status affects up to 20 points.', action: 'Submit your KYB application.' },
        { title: 'No financial documents', detail: 'Financials add credibility.', action: 'Upload bank statements or audited financials.' },
      ],
      top_priority: 'Complete KYB verification',
      estimated_score_uplift: '+10-20 points',
    },
    snapshot,
    generated_at: new Date().toISOString(),
    ai_scored: false,
  }
}
