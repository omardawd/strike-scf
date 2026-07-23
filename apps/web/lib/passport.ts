import { createClient as createAdmin } from '@supabase/supabase-js'
import { callClaude, AI_MODEL, extractJson } from '@/lib/ai'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ComponentScore {
  score: number
  reasoning: string
  flags?: string[]
  document_findings?: string[]
  missing_docs?: string[]
  key_metrics?: Record<string, string | null>
}

export interface ExpertAnalysis {
  scores: {
    kyb_compliance: ComponentScore
    financial_health: ComponentScore & { key_metrics: Record<string, string | null> }
    trade_reliability: ComponentScore
    network_reputation: ComponentScore
  }
  total_score: number
  risk_tier: 'green' | 'amber' | 'red'
  executive_summary: string
  key_strengths: string[]
  risk_flags: string[]
  improvement_actions: string[]
  document_quality: 'complete' | 'partial' | 'missing_critical'
  analyst_confidence: 'high' | 'medium' | 'low'
  analyst_notes: string
  documents_analyzed: string[]
}

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
  expert_analysis?: ExpertAnalysis
}

// ─── Expert system prompt ─────────────────────────────────────────────────────

const EXPERT_SYSTEM =
  `You are a senior credit analyst and trade finance expert with 50 years of experience. You have personally evaluated thousands of businesses — from Fortune 500 corporations to emerging-market SMBs — for multinational banks, SCF platforms, and international trade institutions. Your assessments have supported billions of dollars in trade financing.

You are producing a PassportScore on the Strike SCF platform. This score is used by:
• Banks — to set advance rates, credit limits, and program eligibility
• Trade partners — to decide whether to extend payment terms and transact
• The platform — for risk-based pricing and counterparty matching

You have received every KYB document this organization uploaded PLUS structured platform data. Read every document thoroughly. Cross-reference claims across documents. Check for internal consistency — dates, addresses, names, entity numbers. Be a rigorous expert, not a rubber stamp.

SCORING DIMENSIONS — 25 points each (total 100):

━━ 1. KYB COMPLIANCE & DOCUMENT INTEGRITY (0–25) ━━
Assess: completeness, authenticity signals, UBO transparency, signatory authority chain, address consistency, document dating.
25:   All required docs present and consistent, clean UBO chain disclosed ≥25% threshold, board-authorized signatory confirmed, addresses match across documents, all docs dated correctly
18–24: Complete set with one minor gap or dating issue
12–17: Most docs present but missing 1–2 required items or notable inconsistency
6–11: Significant gaps; cannot verify key claims from documents alone
0–5:  Critical documents absent, integrity concerns, contradictions across documents

Required checklist:
  ✓ Certificate of incorporation / business registration
  ✓ Government photo ID of authorized signatory
  ✓ Proof of business address (< 90 days old)
  ✓ UBO/ownership declaration (signed)
  ✓ Board resolution / authority letter
  + Financial statements (boosts financial_health score; optional for KYB)
  + Bank statements (optional)

━━ 2. FINANCIAL HEALTH & CREDITWORTHINESS (0–25) ━━
If financial statements were provided, read the actual numbers. Analyze: revenue scale, profitability margins, debt-to-equity, current ratio, cash position, credit ratings, growth trajectory.
If NO financial statements: score purely from form-entered revenue range — cap at 15, lower confidence.
23–25: Large profitable enterprise ($250M+ revenue), strong ratios, investment grade or demonstrably creditworthy
18–22: Healthy company ($50M–$250M), manageable debt, positive trajectory
12–17: Good SMB ($10M–$50M), reasonable financial health
6–11: Smaller company ($1M–$10M) or limited financial data
0–5:  Minimal data, early stage, distress signals, or heavy leverage

━━ 3. TRADE RELIABILITY (0–25) ━━
Platform history + inferred reliability from documents. HARD CAP: new entities with zero completed deals on Strike SCF cannot score above 15 here regardless of company size.
22–25: Established platform history, low dispute rate, on-time payments, multiple completed deals
15–21: Good track record, minor issues
8–14: New but clean, or limited prior-trade evidence
3–7:  No platform history, no evidence of prior trade relationships
0–2:  Active disputes, late payment history, or default indicators

━━ 4. NETWORK REPUTATION & MARKET STANDING (0–25) ━━
Public company status, global brand recognition, verifiable banking relationships, sector credibility, geographic footprint.
23–25: Major publicly traded or globally recognized enterprise with easily verifiable market presence and strong institutional banking relationships
18–22: Well-known entity in their sector, verifiable references
12–17: Credible business with moderate public profile
6–11: Unknown SMB, limited verifiable external presence
0–5:  Cannot verify entity or suspicious indicators present

RISK TIER: green ≥ 70 • amber 45–69 • red < 45

Respond with ONLY valid JSON — zero prose, zero markdown fences:
{
  "scores": {
    "kyb_compliance": {
      "score": <integer 0–25>,
      "reasoning": "<2–4 sentences citing specific evidence from the documents you reviewed>",
      "document_findings": ["<one line per document reviewed — e.g. 'Certificate of Incorporation: entity confirmed, Delaware #0683438, incorporated 1969'>"],
      "missing_docs": ["<any required document that was NOT provided>"],
      "flags": ["<specific concern, or omit key if none>"]
    },
    "financial_health": {
      "score": <integer 0–25>,
      "reasoning": "<2–4 sentences citing actual figures from financial statements if available; otherwise note limited data>",
      "key_metrics": {
        "revenue": "<actual figure or range found>",
        "profitability": "<net income or margin if found, else null>",
        "debt_level": "<debt figure or ratio if found, else null>",
        "credit_rating": "<if mentioned in any document, else null>"
      }
    },
    "trade_reliability": {
      "score": <integer 0–25>,
      "reasoning": "<2–4 sentences about platform history and inferred trade reliability>"
    },
    "network_reputation": {
      "score": <integer 0–25>,
      "reasoning": "<2–4 sentences about market standing, brand recognition, banking relationships>"
    }
  },
  "total_score": <integer — must exactly equal sum of the 4 component scores>,
  "risk_tier": "<green|amber|red — derived from total_score per rubric above>",
  "executive_summary": "<6–8 sentences written for a bank credit officer or CFO. State the PassportScore and risk tier. Summarize the most important document findings. Name the top strengths. Call out any meaningful risks or gaps. Be direct and professional.>",
  "key_strengths": ["<3–5 specific, evidence-backed strengths>"],
  "risk_flags": ["<specific flags — empty array if genuinely none>"],
  "improvement_actions": ["<2–4 concrete, actionable steps the organization can take to improve their score>"],
  "document_quality": "<complete|partial|missing_critical>",
  "analyst_confidence": "<high|medium|low — based on data completeness and document quality>",
  "analyst_notes": "<standout observations: cross-reference findings, internal consistencies or inconsistencies, anything a bank reviewer should know>"
}`

// ─── Document priority for download (most informative first) ─────────────────

const DOC_KIND_PRIORITY: Record<string, number> = {
  audited_financials:        1,
  financial_statements:      1,
  certificate_of_incorporation: 2,
  ubo_declaration:           3,
  board_resolution:          4,
  photo_id:                  5,
  proof_of_address:          6,
  bank_statements:           7,
  tax_return:                8,
  ein_letter:                9,
}

const MAX_DOCS     = 8
const MAX_DOC_SIZE = 10 * 1024 * 1024 // 10 MB per document — larger PDFs are skipped

// ─── Download one document from Supabase Storage ─────────────────────────────

async function downloadDocumentContent(
  storagePath: string,
  mimeType: string
): Promise<{ type: 'document' | 'image'; mediaType: string; base64: string } | null> {
  try {
    const { data, error } = await adminClient.storage
      .from('kyb-documents')
      .download(storagePath)
    if (error || !data) return null

    const arrayBuffer = await data.arrayBuffer()
    if (arrayBuffer.byteLength > MAX_DOC_SIZE) {
      console.warn(`[passport] skipping large document (${arrayBuffer.byteLength} bytes): ${storagePath}`)
      return null
    }

    const base64 = Buffer.from(arrayBuffer).toString('base64')

    if (mimeType === 'application/pdf' || storagePath.endsWith('.pdf')) {
      return { type: 'document', mediaType: 'application/pdf', base64 }
    }
    if (mimeType.startsWith('image/')) {
      const media = ['image/jpeg','image/png','image/gif','image/webp'].includes(mimeType)
        ? mimeType
        : 'image/jpeg'
      return { type: 'image', mediaType: media, base64 }
    }
    return null
  } catch (e) {
    console.warn(`[passport] download failed for ${storagePath}:`, e)
    return null
  }
}

// ─── Core: expert scoring with document reading ───────────────────────────────

export async function runExpertPassportScoring(
  orgId: string,
  platformData: {
    completedDeals: number
    tradeVolumeTotal: number
    reviewAvg: number | null
    reviewCount: number
    onTimePaymentRate: number | null
    disputeRate: number | null
  }
): Promise<ExpertAnalysis | null> {

  // 1. Fetch org row
  const { data: org } = await adminClient
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .single()
  if (!org) return null

  // 2. Fetch all documents for this org (entity_type = 'organization')
  const { data: docs, error: docsError } = await adminClient
    .from('documents')
    .select('id, document_kind, name, storage_path, mime_type')
    .eq('entity_type', 'organization')
    .eq('entity_id', orgId)
  if (docsError) {
    console.error(`[passport] documents query failed for org ${orgId}:`, docsError)
  }
  if (!docs || docs.length === 0) {
    console.warn(`[passport] no documents found for org ${orgId}`)
  }

  // 3. Sort by importance, take top MAX_DOCS
  const sorted = [...(docs ?? [])].sort((a, b) => {
    const pa = DOC_KIND_PRIORITY[a.document_kind] ?? 99
    const pb = DOC_KIND_PRIORITY[b.document_kind] ?? 99
    return pa - pb
  }).slice(0, MAX_DOCS)

  // 4. Download documents in parallel
  const downloadResults = await Promise.all(
    sorted.map(async doc => ({
      doc,
      content: await downloadDocumentContent(doc.storage_path, doc.mime_type ?? 'application/pdf'),
    }))
  )

  const successfulDocs = downloadResults.filter(r => r.content !== null)
  const analyzedDocNames = successfulDocs.map(r => `${r.doc.document_kind}: ${r.doc.name}`)

  // 5. Build the user message: structured data block + document content blocks
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userContent: any[] = []

  // Structured platform data as text
  userContent.push({
    type: 'text',
    text: `ORGANIZATION PROFILE (structured platform data):
${JSON.stringify({
  legal_name: org.legal_name,
  doing_business_as: org.doing_business_as,
  org_type: org.type,
  business_type: org.business_type,
  state_of_incorporation: org.state_of_incorporation,
  country_of_incorporation: org.country_of_incorporation,
  industry_naics: org.industry_naics,
  years_in_operation: org.years_in_operation,
  annual_revenue_range: org.annual_revenue_range,
  employee_count_range: org.employee_count_range,
  country_of_origin: org.country_of_origin,
  city: org.city,
  state: org.state,
  website: org.website,
  description: org.description,
  kyb_status: org.kyb_status,
  kyb_submitted_at: org.kyb_submitted_at,
  risk_tier: org.risk_tier,
  risk_flags: org.risk_flags,
  primary_contact_name: org.primary_contact_name,
  primary_contact_title: org.primary_contact_title,
}, null, 2)}

PLATFORM HISTORY:
${JSON.stringify({
  completed_deals_on_platform: platformData.completedDeals,
  total_trade_volume_usd: platformData.tradeVolumeTotal,
  peer_review_avg: platformData.reviewAvg,
  peer_review_count: platformData.reviewCount,
  on_time_payment_rate: platformData.onTimePaymentRate,
  dispute_rate: platformData.disputeRate,
}, null, 2)}

DOCUMENTS ATTACHED BELOW (${successfulDocs.length} of ${docs?.length ?? 0} uploaded documents successfully downloaded):
${analyzedDocNames.map((n, i) => `  ${i + 1}. ${n}`).join('\n')}
${(docs?.length ?? 0) > successfulDocs.length ? `\nNote: ${(docs?.length ?? 0) - successfulDocs.length} document(s) could not be downloaded (access error or unsupported format).` : ''}

Please analyze all documents thoroughly and produce the expert PassportScore JSON.`,
  })

  // Attach each document as a content block
  for (const { doc, content } of successfulDocs) {
    if (!content) continue
    const label = `${doc.document_kind.replace(/_/g, ' ').toUpperCase()} — ${doc.name}`

    if (content.type === 'document') {
      userContent.push({
        type: 'text',
        text: `\n--- DOCUMENT: ${label} ---`,
      })
      userContent.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: content.mediaType,
          data: content.base64,
        },
      })
    } else {
      userContent.push({
        type: 'text',
        text: `\n--- DOCUMENT (IMAGE): ${label} ---`,
      })
      userContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: content.mediaType,
          data: content.base64,
        },
      })
    }
  }

  // 6. Call Claude Sonnet with PDF beta header
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25,prompt-caching-2024-07-31',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        // Was 2048, then 4096 — both confirmed live to truncate mid-JSON: 2048
        // broke on zero-document orgs (verbose "cannot verify" hedging across
        // all 4 rubric sections), and 4096 broke once the documents.size_bytes
        // fix below started actually feeding real documents in — per-document
        // findings across 4 dimensions run well past 4096 tokens. 8192 gives
        // real multi-document analyses headroom without still truncating.
        max_tokens: 8192,
        // EXPERT_SYSTEM has zero interpolation — identical across every org's
        // scoring call — so it's cacheable byte-for-byte via the content-block
        // form (no tools array on this call to hang cache_control off instead).
        system: [{ type: 'text', text: EXPERT_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userContent }],
      }),
    })

    if (!res.ok) {
      const err = await res.text().catch(() => '')
      console.error('[passport] expert scoring API error:', res.status, err.slice(0, 300))
      return null
    }

    const data = await res.json()
    const text: string = data?.content?.[0]?.text ?? ''

    const parsed = extractJson<ExpertAnalysis>(text)
    if (!parsed || typeof parsed.total_score !== 'number') {
      console.error('[passport] expert scoring: invalid JSON response:', text.slice(0, 500))
      return null
    }

    // Sanity-check: total must equal component sum, risk_tier must be valid
    const computedTotal =
      (parsed.scores?.kyb_compliance?.score ?? 0) +
      (parsed.scores?.financial_health?.score ?? 0) +
      (parsed.scores?.trade_reliability?.score ?? 0) +
      (parsed.scores?.network_reputation?.score ?? 0)

    if (Math.abs(computedTotal - parsed.total_score) > 2) {
      parsed.total_score = computedTotal
    }
    parsed.total_score = Math.max(0, Math.min(100, Math.round(parsed.total_score)))

    if (!['green', 'amber', 'red'].includes(parsed.risk_tier)) {
      parsed.risk_tier = parsed.total_score >= 70 ? 'green' : parsed.total_score >= 45 ? 'amber' : 'red'
    }

    parsed.documents_analyzed = analyzedDocNames
    return parsed

  } catch (e) {
    console.error('[passport] expert scoring failed:', e)
    return null
  }
}

// ─── Legacy formula-based recalculate (kept for /api/passport/recalculate) ───

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
    adminClient.from('supplier_performance').select('*').eq('org_id', orgId)
      .order('last_calculated_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    adminClient.from('passport_peer_reviews').select('rating').eq('reviewed_org_id', orgId),
    adminClient.from('deals').select('id, total_value')
      .or(`buyer_org_id.eq.${orgId},supplier_org_id.eq.${orgId}`).eq('status', 'completed'),
    adminClient.from('documents').select('id', { count: 'exact', head: true }).eq('entity_id', orgId),
  ])

  if (!org) throw new Error('Organization not found')

  const oldScore = org.passport_score as number | null
  const completedDealsCount = completedDeals?.length ?? 0
  const tradeVolumeTotal = (completedDeals ?? []).reduce((sum, d) => sum + (d.total_value ?? 0), 0)
  const reviewCount = reviews?.length ?? 0
  const reviewAvg = reviewCount > 0
    ? (reviews ?? []).reduce((s, r) => s + Number(r.rating ?? 0), 0) / reviewCount
    : null

  // Run expert scoring — this is now the primary path
  const platformData = {
    completedDeals: completedDealsCount,
    tradeVolumeTotal,
    reviewAvg,
    reviewCount,
    onTimePaymentRate: perf?.on_time_payment_rate ?? null,
    disputeRate: perf?.dispute_rate ?? null,
  }
  const expertAnalysis = await runExpertPassportScoring(orgId, platformData)

  let totalScore: number
  let riskTier: 'green' | 'amber' | 'red'
  let narrative: string = (org.passport_narrative as string | null) ?? ''

  if (expertAnalysis) {
    totalScore = expertAnalysis.total_score
    riskTier = expertAnalysis.risk_tier
    narrative = expertAnalysis.executive_summary

    const kybC   = expertAnalysis.scores.kyb_compliance.score
    const finH   = expertAnalysis.scores.financial_health.score
    const tradeR = expertAnalysis.scores.trade_reliability.score
    const netRep = expertAnalysis.scores.network_reputation.score

    await adminClient.from('organizations').update({
      passport_score:                   totalScore,
      passport_score_updated_at:        now,
      passport_narrative:               narrative,
      passport_narrative_updated_at:    now,
      risk_score:                       totalScore,
      risk_tier:                        riskTier,
      risk_flags:                       expertAnalysis.risk_flags ?? [],
      passport_expert_analysis:         JSON.stringify(expertAnalysis),
      passport_ai_evaluated_at:         now,
      updated_at:                       now,
    }).eq('id', orgId)

    void adminClient.from('agent_actions').insert({
      org_id: orgId,
      action_type: 'passport_narrative_generated',
      entity_type: 'organization',
      entity_id: orgId,
      reasoning: `Expert PassportScore: ${oldScore ?? '—'} → ${totalScore} (${riskTier}). Docs analyzed: ${expertAnalysis.documents_analyzed?.length ?? 0}. Confidence: ${expertAnalysis.analyst_confidence}`,
      input_summary: `KYB=${kybC} Financial=${finH} Trade=${tradeR} Reputation=${netRep}. DocQuality:${expertAnalysis.document_quality}`,
      output_summary: `Score ${totalScore} (${riskTier}). ${narrative.slice(0, 200)}`,
      outcome: 'score_updated',
      model: 'claude-sonnet-4-6',
      requires_approval: false,
    })

    return {
      org_id: orgId,
      old_score: oldScore,
      new_score: totalScore,
      risk_tier: riskTier,
      components: {
        kyb_compliance: kybC,
        platform_behavior: tradeR,
        financial_health: finH,
        trade_reputation: netRep,
      },
      expert_analysis: expertAnalysis,
    }
  }

  // ── Formula fallback if expert scoring fails ──────────────────────────────

  let kybBase = 0
  if (org.kyb_status === 'approved') kybBase = 20
  else if (org.kyb_status === 'under_review') kybBase = 10
  else if (org.kyb_status === 'submitted') kybBase = 8
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

  const dealPoints = Math.min(completedDealsCount * 2, 10)
  const reviewPoints = reviewAvg !== null && reviewCount >= 2 ? Math.min(reviewAvg * 2, 10) : 0
  const comp4 = Math.round(dealPoints + reviewPoints)

  totalScore = Math.max(0, Math.min(100, comp1 + comp2 + comp3 + comp4))
  riskTier = tierFromScore(totalScore)

  let tokensUsed = 0
  try {
    const res = await callClaude({
      system: NARRATIVE_SYSTEM,
      messages: [{
        role: 'user',
        content: JSON.stringify({
          legal_name: org.legal_name,
          type: org.type,
          kyb_status: org.kyb_status,
          years_in_operation: org.years_in_operation,
          annual_revenue_range: org.annual_revenue_range,
          country_of_origin: org.country_of_origin,
          completed_deals: completedDealsCount,
          passport_score: totalScore,
          risk_tier: riskTier,
          peer_review_avg: reviewAvg,
        }),
      }],
      max_tokens: 300,
    })
    if (res.text.trim()) narrative = res.text.trim()
    tokensUsed = (res.usage.input_tokens ?? 0) + (res.usage.output_tokens ?? 0)
  } catch (e) {
    console.error('[passport/recalculate] narrative generation failed:', e)
  }

  await adminClient.from('organizations').update({
    passport_score: totalScore,
    passport_score_updated_at: now,
    risk_score: totalScore,
    risk_tier: riskTier,
    passport_narrative: narrative,
    passport_narrative_updated_at: now,
    updated_at: now,
  }).eq('id', orgId)

  void adminClient.from('agent_actions').insert({
    org_id: orgId,
    action_type: 'passport_narrative_generated',
    entity_type: 'organization',
    entity_id: orgId,
    reasoning: `PassportScore (formula fallback): ${oldScore ?? '—'} → ${totalScore} (${riskTier})`,
    input_summary: `KYB=${comp1} Platform=${comp2} Financial=${comp3} Trade=${comp4}. Deals:${completedDealsCount}`,
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
    components: { kyb_compliance: comp1, platform_behavior: comp2, financial_health: comp3, trade_reputation: comp4 },
  }
}
