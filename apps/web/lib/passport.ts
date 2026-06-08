import { createClient as createAdmin } from '@supabase/supabase-js'
import { callClaude, AI_MODEL } from '@/lib/ai'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const REVENUE_SCORES: Record<string, number> = {
  '<$1m': 5,
  '$1m–$10m': 12, '$1m-$10m': 12,
  '$10m–$50m': 18, '$10m-$50m': 18,
  '$50m–$250m': 22, '$50m-$250m': 22,
  '$250m+': 25,
}

function revenueScore(range: string | null): number {
  if (!range) return 0
  return REVENUE_SCORES[range.toLowerCase().replace(/\s/g, '')] ?? 0
}

function tierFromScore(score: number): 'green' | 'amber' | 'red' {
  if (score >= 70) return 'green'
  if (score >= 45) return 'amber'
  return 'red'
}

const NARRATIVE_SYSTEM =
  'You are Strike AI writing a professional Passport narrative for a supply-chain finance platform. ' +
  'Write exactly 2-3 factual sentences summarizing this organization\'s trade credentials and risk standing. ' +
  'No marketing language. CFO audience. Respond with only the narrative text — no JSON, no formatting, no preamble.'

export interface RecalcResult {
  org_id: string
  old_score: number | null
  new_score: number
  risk_tier: 'green' | 'amber' | 'red'
  components: {
    kyb_compliance: number
    platform_behavior: number
    financial_health: number
    trade_reputation: number
  }
}

export async function runPassportRecalculate(orgId: string): Promise<RecalcResult> {
  const now = new Date().toISOString()

  const [
    { data: org },
    { data: perf },
    { data: reviews },
    { data: completedDeals },
    { count: docCount },
  ] = await Promise.all([
    adminClient.from('organizations').select('*').eq('id', orgId).single(),
    adminClient
      .from('supplier_performance')
      .select('*')
      .eq('org_id', orgId)
      .order('last_calculated_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    adminClient
      .from('passport_peer_reviews')
      .select('rating')
      .eq('reviewed_org_id', orgId),
    adminClient
      .from('deals')
      .select('id, total_value')
      .or(`buyer_org_id.eq.${orgId},supplier_org_id.eq.${orgId}`)
      .eq('status', 'completed'),
    adminClient
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('entity_id', orgId),
  ])

  const completedDealsCount = completedDeals?.length ?? 0
  const tradeVolumeTotal = (completedDeals ?? []).reduce((sum, d) => sum + (d.total_value ?? 0), 0)

  if (!org) throw new Error('Organization not found')

  const oldScore = org.passport_score as number | null

  const reviewCount = reviews?.length ?? 0
  const reviewAvg =
    reviewCount > 0
      ? (reviews ?? []).reduce((s, r) => s + Number(r.rating ?? 0), 0) / reviewCount
      : null

  const banksTransactedCount = (org.banks_transacted_with as string[] | null)?.length ?? 0

  let kybBase = 0
  if (org.kyb_status === 'approved') kybBase = 20
  else if (org.kyb_status === 'under_review') kybBase = 10
  const docBonus = Math.min(docCount ?? 0, 5)
  const comp1 = Math.min(kybBase + docBonus, 25)

  let comp2 = 12
  if (perf && (perf.total_transactions ?? 0) > 0) {
    const onTimeScore = Math.min((perf.on_time_payment_rate ?? 0) * 15, 15)
    const noDisputeScore = Math.min((1 - (perf.dispute_rate ?? 0)) * 10, 10)
    comp2 = Math.round(onTimeScore + noDisputeScore)
  }

  const revScore = revenueScore(org.annual_revenue_range)
  const yearsBonus = Math.min(Math.floor((org.years_in_operation ?? 0) / 2), 3)
  const comp3 = Math.min(revScore + yearsBonus, 25)

  const dealPoints = Math.min((completedDealsCount ?? 0) * 2, 10)
  const reviewPoints =
    reviewAvg !== null && reviewCount >= 2 ? Math.min(reviewAvg * 2, 10) : 0
  const bankPoints = Math.min(banksTransactedCount * 2.5, 5)
  const comp4 = Math.round(dealPoints + reviewPoints + bankPoints)

  const totalScore = Math.max(0, Math.min(100, comp1 + comp2 + comp3 + comp4))
  const riskTier = tierFromScore(totalScore)

  let narrative = (org.passport_narrative as string | null) ?? ''
  let tokensUsed = 0
  try {
    const res = await callClaude({
      system: NARRATIVE_SYSTEM,
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            legal_name: org.legal_name,
            type: org.type,
            kyb_status: org.kyb_status,
            years_in_operation: org.years_in_operation,
            annual_revenue_range: org.annual_revenue_range,
            country_of_origin: org.country_of_origin,
            completed_deals: completedDealsCount ?? 0,
            passport_score: totalScore,
            risk_tier: riskTier,
            peer_review_avg: reviewAvg,
            review_count: reviewCount,
            on_time_payment_rate: perf?.on_time_payment_rate ?? null,
            dispute_rate: perf?.dispute_rate ?? null,
          }),
        },
      ],
      max_tokens: 300,
    })
    if (res.text.trim()) narrative = res.text.trim()
    tokensUsed = (res.usage.input_tokens ?? 0) + (res.usage.output_tokens ?? 0)
  } catch (e) {
    console.error('[passport/recalculate] narrative generation failed:', e)
  }

  const { data: supplierDeals } = await adminClient
    .from('deals')
    .select('payment_days_actual')
    .eq('supplier_org_id', orgId)
    .eq('status', 'completed')
    .not('payment_days_actual', 'is', null)

  const payDaysList = (supplierDeals ?? [])
    .map((d) => d.payment_days_actual)
    .filter((n): n is number => typeof n === 'number')
  const avgPayDays =
    payDaysList.length > 0
      ? Math.round(payDaysList.reduce((a, b) => a + b, 0) / payDaysList.length)
      : (org.avg_payment_days as number | null) ?? null

  await adminClient
    .from('organizations')
    .update({
      passport_score: totalScore,
      passport_score_updated_at: now,
      risk_score: totalScore,
      risk_tier: riskTier,
      trade_count_total: completedDealsCount,
      trade_volume_total: tradeVolumeTotal,
      avg_payment_days: avgPayDays,
      dispute_rate_network: perf?.dispute_rate ?? null,
      passport_narrative: narrative,
      passport_narrative_updated_at: now,
      updated_at: now,
    })
    .eq('id', orgId)

  void adminClient
    .from('agent_actions')
    .insert({
      org_id: orgId,
      action_type: 'passport_narrative_generated',
      entity_type: 'organization',
      entity_id: orgId,
      reasoning: `PassportScore recalculated: ${oldScore ?? '—'} → ${totalScore} (${riskTier})`,
      input_summary: `KYB=${comp1} Platform=${comp2} Financial=${comp3} Trade=${comp4}. Deals:${completedDealsCount ?? 0} Reviews:${reviewCount}`,
      output_summary: `Score ${totalScore} (${riskTier})${narrative ? '. ' + narrative.slice(0, 200) : ''}`,
      outcome: 'score_updated',
      model: AI_MODEL,
      tokens_used: tokensUsed,
      requires_approval: false,
    })

  return {
    org_id: orgId,
    old_score: oldScore,
    new_score: totalScore,
    risk_tier: riskTier,
    components: {
      kyb_compliance: comp1,
      platform_behavior: comp2,
      financial_health: comp3,
      trade_reputation: comp4,
    },
  }
}
