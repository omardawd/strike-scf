import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { callClaude, extractJson, AI_MODEL } from '@/lib/ai'
import { sendEmail, passportLiveEmailHtml, passportReviewEmailHtml } from '@/lib/email'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES = ['bank_admin', 'bank_credit_officer']

const REVIEW_SYSTEM =
  'You are Strike AI performing an initial KYB (Know Your Business) review for a supply-chain finance ' +
  'platform. Assess the organization using ONLY the data provided. Respond with a single JSON object and ' +
  'nothing else, matching exactly:\n' +
  '{\n' +
  '  "document_completeness": { "score_0_25": <number 0-25>, "missing": [<string>], "summary": <string> },\n' +
  '  "risk_assessment": <string, 2-3 sentences, factual, CFO audience>,\n' +
  '  "passport_narrative": <string, 2-3 sentences, professional, no marketing language, CFO audience>,\n' +
  '  "risk_flags": [<short string>]\n' +
  '}\n' +
  'Be conservative and factual. Do not invent data. If a document set looks thin, reflect that in the score.'

// ── Deterministic scoring components (each 0-25) ────────────────────────────

function revenueScore(range: string | null | undefined): number {
  if (!range) return 10
  const s = String(range).toLowerCase()
  let maxVal = 0
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*([kmb])?/g)) {
    let v = parseFloat(m[1] ?? '0')
    const suf = m[2]
    if (suf === 'k') v *= 1e3
    else if (suf === 'm') v *= 1e6
    else if (suf === 'b') v *= 1e9
    else if (v < 1000) v *= 1e6 // bare numbers in a revenue band are millions
    maxVal = Math.max(maxVal, v)
  }
  if (maxVal >= 100e6) return 25
  if (maxVal >= 50e6) return 22
  if (maxVal >= 25e6) return 19
  if (maxVal >= 10e6) return 16
  if (maxVal >= 5e6) return 13
  if (maxVal >= 1e6) return 10
  if (maxVal > 0) return 6
  return 10
}

function yearsScore(years: number | null | undefined): number {
  if (years == null) return 8
  if (years >= 10) return 25
  if (years >= 7) return 22
  if (years >= 4) return 18
  if (years >= 2) return 12
  if (years >= 1) return 8
  return 5
}

function completenessScore(aiVal: unknown, docCount: number): number {
  if (typeof aiVal === 'number' && Number.isFinite(aiVal)) {
    return Math.max(0, Math.min(25, Math.round(aiVal)))
  }
  return Math.max(0, Math.min(25, Math.round((docCount / 5) * 25)))
}

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
  components: { kyb_completeness: number; financial_health: number; years_operating: number; base: number }
  document_completeness: unknown
}

// Core routine — also invoked from the onboarding submit route.
export async function runKybAiReview(
  orgId: string,
  opts: { triggeredByUserId?: string } = {}
): Promise<KybReviewResult> {
  const { data: org } = await adminClient
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .single()
  if (!org) throw new Error('Organization not found')

  const { data: docs } = await adminClient
    .from('documents')
    .select('document_kind, name')
    .eq('entity_type', 'kyb')
    .eq('entity_id', orgId)

  const docKinds = (docs ?? []).map(d => d.document_kind).filter(Boolean)
  const docCount = docKinds.length

  const reviewContext = {
    legal_name: org.legal_name,
    doing_business_as: org.doing_business_as,
    type: org.type,
    business_type: org.business_type,
    state_of_incorporation: org.state_of_incorporation,
    country_of_incorporation: org.country_of_incorporation,
    industry_naics: org.industry_naics,
    years_in_operation: org.years_in_operation,
    annual_revenue_range: org.annual_revenue_range,
    employee_count_range: org.employee_count_range,
    country_of_origin: org.country_of_origin,
    sourcing_countries: org.sourcing_countries,
    product_categories: org.product_categories,
    website: org.website,
    description: org.description,
    documents_submitted: docKinds,
    document_count: docCount,
  }

  // ── AI pass: completeness + risk + narrative + flags ──────────────────────
  let aiCompleteness: unknown = null
  let riskAssessment = ''
  let narrative = ''
  let riskFlags: string[] = []
  let tokensTotal = 0
  let aiUsage: { input_tokens?: number; output_tokens?: number } = {}

  try {
    const res = await callClaude({
      system: REVIEW_SYSTEM,
      messages: [{ role: 'user', content: `Organization data:\n${JSON.stringify(reviewContext, null, 2)}` }],
      max_tokens: 700,
    })
    aiUsage = res.usage
    tokensTotal = (res.usage.input_tokens ?? 0) + (res.usage.output_tokens ?? 0)
    const parsed = extractJson<{
      document_completeness?: { score_0_25?: number; missing?: string[]; summary?: string }
      risk_assessment?: string
      passport_narrative?: string
      risk_flags?: string[]
    }>(res.text)
    if (parsed) {
      aiCompleteness = parsed.document_completeness ?? null
      riskAssessment = (parsed.risk_assessment ?? '').trim()
      narrative = (parsed.passport_narrative ?? '').trim()
      riskFlags = Array.isArray(parsed.risk_flags)
        ? parsed.risk_flags.filter(f => typeof f === 'string' && f.trim()).slice(0, 8)
        : []
    }
  } catch (e) {
    console.error('[kyb/ai-review] AI call failed, using deterministic fallback:', e)
  }

  if (!narrative) narrative = fallbackNarrative(org)
  if (!riskAssessment) riskAssessment = `Automated review completed from ${docCount} submitted document(s). Manual confirmation recommended where data is sparse.`

  // ── Score: KYB completeness + financial health + longevity + new-org base ──
  const completenessVal =
    aiCompleteness && typeof aiCompleteness === 'object'
      ? (aiCompleteness as { score_0_25?: number }).score_0_25
      : null
  const kybCompleteness = completenessScore(completenessVal, docCount)
  const financialHealth = revenueScore(org.annual_revenue_range)
  const yearsOperating = yearsScore(org.years_in_operation)
  const BASE = 25

  const passportScore = Math.max(0, Math.min(100, Math.round(kybCompleteness + financialHealth + yearsOperating + BASE)))
  const tier = tierFromScore(passportScore)
  const approved = passportScore >= 60
  const kybStatus: 'approved' | 'under_review' = approved ? 'approved' : 'under_review'
  const now = new Date().toISOString()

  // Add a low-data flag if the document set is thin.
  if (docCount < 3 && !riskFlags.some(f => /document/i.test(f))) {
    riskFlags = [...riskFlags, 'Limited documentation on file']
  }

  // ── Persist passport fields on the org ────────────────────────────────────
  const orgUpdate: Record<string, unknown> = {
    passport_score: passportScore,
    passport_score_updated_at: now,
    passport_narrative: narrative,
    passport_narrative_updated_at: now,
    risk_score: passportScore,
    risk_tier: tier,
    risk_flags: riskFlags,
    kyb_status: kybStatus,
    kyb_ai_reviewed_at: now,
    updated_at: now,
  }
  if (approved) {
    orgUpdate.status = 'active'
    orgUpdate.passport_published_at = now
    orgUpdate.network_visible = true
  }
  await adminClient.from('organizations').update(orgUpdate).eq('id', orgId)

  // ── credit_scores row ─────────────────────────────────────────────────────
  try {
    await adminClient.from('credit_scores').insert({
      org_id: orgId,
      score_business_longevity: yearsOperating,
      score_revenue_scale: financialHealth,
      score_document_completeness: kybCompleteness,
      score_financial_health: financialHealth,
      score_program_fit: 0,
      score_counterparty_tenure: 0,
      total_score: passportScore,
      risk_tier: tier,
      financial_health_notes: riskAssessment.slice(0, 1000),
    })
  } catch (e) {
    console.error('[kyb/ai-review] credit_scores insert failed:', e)
  }

  // ── agent_actions audit row ───────────────────────────────────────────────
  try {
    await adminClient.from('agent_actions').insert({
      org_id: orgId,
      action_type: 'passport_narrative_generated',
      entity_type: 'organization',
      entity_id: orgId,
      reasoning: riskAssessment.slice(0, 1000),
      input_summary: `KYB AI review — ${docCount} document(s), revenue ${org.annual_revenue_range ?? 'n/a'}, ${org.years_in_operation ?? '?'}y in operation`,
      output_summary: `PassportScore ${passportScore} (${tier}); ${approved ? 'approved & published' : 'routed to human review'}. ${narrative.slice(0, 280)}`,
      outcome: approved ? 'passport_published' : 'under_review',
      model: AI_MODEL,
      tokens_used: tokensTotal,
      requires_approval: false,
    })
  } catch (e) {
    console.error('[kyb/ai-review] agent_actions insert failed:', e)
  }

  // ── ai_usage (only when we can attribute to a user) ───────────────────────
  if (opts.triggeredByUserId && tokensTotal > 0) {
    try {
      await adminClient.from('ai_usage').insert({
        user_id: opts.triggeredByUserId,
        org_id: orgId,
        feature: 'scoring',
        tokens_input: aiUsage.input_tokens ?? 0,
        tokens_output: aiUsage.output_tokens ?? 0,
        tokens_total: tokensTotal,
        model: AI_MODEL,
      })
    } catch (e) {
      console.error('[kyb/ai-review] ai_usage insert failed:', e)
    }
  }

  // ── Notify the applicant ──────────────────────────────────────────────────
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
    risk_tier: tier,
    risk_flags: riskFlags,
    kyb_status: kybStatus,
    approved,
    narrative,
    components: { kyb_completeness: kybCompleteness, financial_health: financialHealth, years_operating: yearsOperating, base: BASE },
    document_completeness: aiCompleteness,
  }
}

// POST /api/kyb/ai-review  { org_id }
// Callable by the org itself (post-onboarding) or by a bank reviewer.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, role, org_id, bank_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { org_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const orgId = body.org_id
  if (!orgId) return NextResponse.json({ error: 'org_id is required' }, { status: 400 })

  const isOwnOrg = me.org_id === orgId
  const isBank = BANK_ROLES.includes(me.role)
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
