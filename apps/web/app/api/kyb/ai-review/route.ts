import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { AI_MODEL } from '@/lib/ai'
import { sendEmail, passportLiveEmailHtml, passportReviewEmailHtml } from '@/lib/email'
import { runExpertPassportScoring, type ExpertAnalysis } from '@/lib/passport'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES = ['bank_admin', 'bank_credit_officer']

function tierFromScore(score: number): 'green' | 'amber' | 'red' {
  if (score >= 70) return 'green'
  if (score >= 45) return 'amber'
  return 'red'
}

function fallbackNarrative(org: Record<string, unknown>): string {
  const name = (org.doing_business_as || org.legal_name || 'This organization') as string
  const kind = org.type === 'anchor' ? 'buyer' : 'supplier'
  const years = org.years_in_operation ? `${org.years_in_operation} years in operation` : 'an emerging operating history'
  return `${name} is a ${kind} with ${years}. Its Strike Passport reflects the data verified during KYB; performance metrics will deepen as trade history accumulates on the network.`
}

export interface KybReviewResult {
  org_id: string
  passport_score: number
  risk_score: number
  risk_tier: 'green' | 'amber' | 'red'
  risk_flags: string[]
  kyb_status: 'approved' | 'under_review'
  approved: boolean
  narrative: string
  expert_analysis: ExpertAnalysis | null
  components: {
    kyb_compliance: number
    financial_health: number
    trade_reliability: number
    network_reputation: number
  }
}

// Core routine — invoked from onboarding submit and directly from this route.
export async function runKybAiReview(
  orgId: string,
  opts: { triggeredByUserId?: string } = {}
): Promise<KybReviewResult> {
  const now = new Date().toISOString()

  const { data: org } = await adminClient.from('organizations').select('*').eq('id', orgId).single()
  if (!org) throw new Error('Organization not found')

  // Gather platform history for the expert scorer
  const [
    { data: perf },
    { data: reviews },
    { data: completedDeals },
  ] = await Promise.all([
    adminClient.from('supplier_performance').select('on_time_payment_rate, dispute_rate, total_transactions')
      .eq('org_id', orgId).order('last_calculated_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    adminClient.from('passport_peer_reviews').select('rating').eq('reviewed_org_id', orgId),
    adminClient.from('deals').select('id, total_value')
      .or(`buyer_org_id.eq.${orgId},supplier_org_id.eq.${orgId}`).eq('status', 'completed'),
  ])

  const completedDealsCount = completedDeals?.length ?? 0
  const tradeVolumeTotal = (completedDeals ?? []).reduce((s, d) => s + (d.total_value ?? 0), 0)
  const reviewCount = reviews?.length ?? 0
  const reviewAvg = reviewCount > 0
    ? (reviews ?? []).reduce((s, r) => s + Number(r.rating ?? 0), 0) / reviewCount
    : null

  // ── Expert document analysis (primary path) ───────────────────────────────
  let expertAnalysis: ExpertAnalysis | null = null
  try {
    expertAnalysis = await runExpertPassportScoring(orgId, {
      completedDeals: completedDealsCount,
      tradeVolumeTotal,
      reviewAvg,
      reviewCount,
      onTimePaymentRate: perf?.on_time_payment_rate ?? null,
      disputeRate: perf?.dispute_rate ?? null,
    })
  } catch (e) {
    console.error('[kyb/ai-review] expert scoring failed, using formula fallback:', e)
  }

  let passportScore: number
  let riskTier: 'green' | 'amber' | 'red'
  let narrative: string
  let riskFlags: string[]
  let components: KybReviewResult['components']

  if (expertAnalysis) {
    // Expert analysis succeeded — use it directly
    passportScore = expertAnalysis.total_score
    riskTier     = expertAnalysis.risk_tier
    narrative    = expertAnalysis.executive_summary || fallbackNarrative(org)
    riskFlags    = expertAnalysis.risk_flags ?? []
    components   = {
      kyb_compliance:   expertAnalysis.scores.kyb_compliance.score,
      financial_health: expertAnalysis.scores.financial_health.score,
      trade_reliability: expertAnalysis.scores.trade_reliability.score,
      network_reputation: expertAnalysis.scores.network_reputation.score,
    }
  } else {
    // ── Formula fallback ───────────────────────────────────────────────────
    // Fetch doc count (entity_type = 'organization', not 'kyb')
    const { count: docCount } = await adminClient
      .from('documents').select('id', { count: 'exact', head: true })
      .eq('entity_type', 'organization').eq('entity_id', orgId)

    let kybBase = 0
    if (org.kyb_status === 'approved') kybBase = 20
    else if (org.kyb_status === 'under_review') kybBase = 10
    else if (org.kyb_status === 'submitted') kybBase = 8
    const comp1 = Math.min(kybBase + Math.min(docCount ?? 0, 5), 25)

    // Revenue-based financial score
    const range: string = String(org.annual_revenue_range ?? '').toLowerCase()
    let maxRevVal = 0
    for (const m of range.matchAll(/(\d+(?:\.\d+)?)\s*([kmb])?/g)) {
      let v = parseFloat(m[1] ?? '0')
      const suf = m[2]
      if (suf === 'k') v *= 1e3
      else if (suf === 'm') v *= 1e6
      else if (suf === 'b') v *= 1e9
      else if (v < 1000) v *= 1e6
      maxRevVal = Math.max(maxRevVal, v)
    }
    const comp2 = maxRevVal >= 100e6 ? 25 : maxRevVal >= 50e6 ? 22 : maxRevVal >= 10e6 ? 16 : maxRevVal >= 1e6 ? 10 : 10

    // Years in operation
    const yrs = org.years_in_operation ?? 0
    const comp3 = yrs >= 10 ? 25 : yrs >= 7 ? 22 : yrs >= 4 ? 18 : yrs >= 2 ? 12 : yrs >= 1 ? 8 : 5

    // Platform track record
    const comp4 = Math.min(completedDealsCount * 2 + (reviewAvg ? Math.min(reviewAvg * 2, 8) : 0), 25)

    passportScore = Math.max(0, Math.min(100, Math.round(comp1 + comp2 + comp3 + comp4)))
    riskTier      = tierFromScore(passportScore)
    narrative     = fallbackNarrative(org)
    riskFlags     = docCount && docCount < 3 ? ['Limited documentation on file'] : []
    components    = {
      kyb_compliance:    comp1,
      financial_health:  comp2,
      trade_reliability: comp4,
      network_reputation: comp3,
    }
  }

  const approved   = passportScore >= 60
  const kybStatus: 'approved' | 'under_review' = approved ? 'approved' : 'under_review'

  // ── Persist to organizations ───────────────────────────────────────────────
  const orgUpdate: Record<string, unknown> = {
    passport_score:                passportScore,
    passport_score_updated_at:     now,
    passport_narrative:            narrative,
    passport_narrative_updated_at: now,
    risk_score:                    passportScore,
    risk_tier:                     riskTier,
    risk_flags:                    riskFlags,
    kyb_status:                    kybStatus,
    kyb_ai_reviewed_at:            now,
    updated_at:                    now,
  }
  if (expertAnalysis) {
    orgUpdate.passport_expert_analysis = JSON.stringify(expertAnalysis)
    orgUpdate.passport_ai_evaluated_at = now
  }
  if (approved) {
    orgUpdate.status                = 'active'
    orgUpdate.passport_published_at = now
    orgUpdate.network_visible       = true
  }
  await adminClient.from('organizations').update(orgUpdate).eq('id', orgId)

  // ── credit_scores row ──────────────────────────────────────────────────────
  try {
    await adminClient.from('credit_scores').insert({
      org_id:                       orgId,
      score_business_longevity:     components.network_reputation,
      score_revenue_scale:          components.financial_health,
      score_document_completeness:  components.kyb_compliance,
      score_financial_health:       components.financial_health,
      score_program_fit:            0,
      score_counterparty_tenure:    components.trade_reliability,
      total_score:                  passportScore,
      risk_tier:                    riskTier,
      financial_health_notes:       expertAnalysis?.analyst_notes?.slice(0, 1000)
        ?? `Formula fallback — PassportScore ${passportScore}`,
    })
  } catch (e) {
    console.error('[kyb/ai-review] credit_scores insert failed:', e)
  }

  // ── agent_actions audit row ────────────────────────────────────────────────
  try {
    const docsAnalyzed = expertAnalysis?.documents_analyzed?.length ?? 0
    await adminClient.from('agent_actions').insert({
      org_id:          orgId,
      action_type:     'passport_narrative_generated',
      entity_type:     'organization',
      entity_id:       orgId,
      reasoning:       expertAnalysis
        ? `Expert PassportScore: ${passportScore} (${riskTier}). ${docsAnalyzed} document(s) analyzed. Confidence: ${expertAnalysis.analyst_confidence}.`
        : `Formula fallback PassportScore: ${passportScore} (${riskTier}).`,
      input_summary:   `KYB=${components.kyb_compliance} Financial=${components.financial_health} Trade=${components.trade_reliability} Reputation=${components.network_reputation}`,
      output_summary:  `Score ${passportScore} (${riskTier}); ${approved ? 'approved' : 'under review'}. ${narrative.slice(0, 280)}`,
      outcome:         approved ? 'passport_published' : 'under_review',
      model:           expertAnalysis ? 'claude-sonnet-4-6' : AI_MODEL,
      requires_approval: false,
    })
  } catch (e) {
    console.error('[kyb/ai-review] agent_actions insert failed:', e)
  }

  // ── ai_usage log ───────────────────────────────────────────────────────────
  if (opts.triggeredByUserId && expertAnalysis) {
    try {
      await adminClient.from('ai_usage').insert({
        user_id:       opts.triggeredByUserId,
        org_id:        orgId,
        feature:       'scoring',
        tokens_input:  0,
        tokens_output: 0,
        tokens_total:  0,
        model:         'claude-sonnet-4-6',
      })
    } catch { /* non-fatal */ }
  }

  // ── Email the applicant ────────────────────────────────────────────────────
  if (org.primary_contact_email) {
    const recipientName = org.primary_contact_name || 'there'
    const orgName = org.doing_business_as || org.legal_name || 'Your organization'
    await sendEmail({
      to: org.primary_contact_email,
      subject: approved ? 'Your Strike Passport is live' : 'Your application needs additional review',
      html: approved
        ? passportLiveEmailHtml({ recipientName, orgName, score: passportScore })
        : passportReviewEmailHtml({ recipientName, orgName }),
    })
  }

  return {
    org_id: orgId,
    passport_score: passportScore,
    risk_score: passportScore,
    risk_tier: riskTier,
    risk_flags: riskFlags,
    kyb_status: kybStatus,
    approved,
    narrative,
    expert_analysis: expertAnalysis,
    components,
  }
}

// POST /api/kyb/ai-review  { org_id }
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users').select('id, role, org_id, bank_id').eq('id', user.id).single()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { org_id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const orgId = body.org_id
  if (!orgId) return NextResponse.json({ error: 'org_id is required' }, { status: 400 })

  const isOwnOrg     = me.org_id === orgId
  const isBank       = BANK_ROLES.includes(me.role)
  const isStrikeAdmin = me.role === 'strike_admin'
  if (!isOwnOrg && !isBank && !isStrikeAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const result = await runKybAiReview(orgId, { triggeredByUserId: me.id })
    return NextResponse.json(result)
  } catch (e) {
    console.error('[kyb/ai-review] failed:', e)
    return NextResponse.json({ error: 'KYB review failed' }, { status: 500 })
  }
}
