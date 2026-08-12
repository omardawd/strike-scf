// Shared logic for AI-assisted RFx (RFQ/RFP) drafting and evaluation.
// Used by app/api/ai/rfx/* routes. Reuses callClaude/extractJson (lib/ai.ts)
// and the existing pricing-benchmark tool (get-pricing-insights.ts) rather
// than duplicating either.
import { callClaude, extractJson } from '@/lib/ai'
import { getPricingInsights } from '@/lib/ai/tools/handlers/get-pricing-insights'

export interface RfxLineItem {
  name: string
  description?: string
  quantity?: number
  unit?: string
  unit_price?: number
  currency?: string
}

export interface RfxContext {
  title?: string
  description?: string
  category?: string
  currency?: string
  incoterms?: string
  delivery_location?: string
  delivery_deadline?: string
  payment_terms?: string
  line_items?: RfxLineItem[]
  // Deal-context fields (entity_type: 'deal')
  buyer_name?: string
  supplier_name?: string
  goods_description?: string
}

export type RfxDocType = 'rfx' | 'invoice'

export type HighlightSeverity = 'info' | 'warning' | 'critical'

export interface RfxHighlight {
  quote: string
  section: string
  severity: HighlightSeverity
  issue: string
  suggestion: string
}

export type RfxSection = 'completeness' | 'competitiveness' | 'pricing' | 'risk'

export interface RfxScoreResult {
  overall_score: number
  section_scores: Record<RfxSection, number>
  highlights: RfxHighlight[]
  ai_scored: boolean
}

export interface RfxPriceAssessment {
  verdict: string | null
  delta_from_platform_avg_pct: number | null
  summary: string
}

// ── Content-block builder for uploaded files (mirrors listings/extract/route.ts) ──

export type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } }

function extractPrintableText(bytes: Uint8Array): string {
  const chunks: string[] = []
  let current = ''
  for (const b of bytes) {
    if ((b >= 32 && b <= 126) || b === 9 || b === 10 || b === 13) {
      current += String.fromCharCode(b)
    } else {
      if (current.length >= 4) chunks.push(current.trim())
      current = ''
    }
  }
  if (current.length >= 4) chunks.push(current.trim())
  return chunks.filter(Boolean).join(' ')
}

export async function fileToContentBlockOrText(file: File): Promise<{ block?: ClaudeContentBlock; text?: string; error?: string }> {
  const mimeType = file.type
  const fileName = file.name.toLowerCase()
  const buf = await file.arrayBuffer()

  if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
    const base64 = Buffer.from(buf).toString('base64')
    return { block: { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } } }
  }
  if (mimeType.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/.test(fileName)) {
    const imgMime = mimeType.startsWith('image/') ? mimeType : 'image/jpeg'
    const base64 = Buffer.from(buf).toString('base64')
    return { block: { type: 'image', source: { type: 'base64', media_type: imgMime, data: base64 } } }
  }
  const bytes = new Uint8Array(buf)
  const text = extractPrintableText(bytes).slice(0, 20000)
  if (!text.trim()) {
    return { error: 'Could not read text content from this file. Please try a PDF, image, or plain text document.' }
  }
  return { text }
}

// ── Generation ──────────────────────────────────────────────────────────────

function formatContextForPrompt(context: RfxContext): string {
  const lines: string[] = []
  if (context.title) lines.push(`Title: ${context.title}`)
  if (context.description) lines.push(`Description: ${context.description}`)
  if (context.category) lines.push(`Category: ${context.category}`)
  if (context.buyer_name) lines.push(`Buyer: ${context.buyer_name}`)
  if (context.supplier_name) lines.push(`Supplier: ${context.supplier_name}`)
  if (context.goods_description) lines.push(`Goods/Services: ${context.goods_description}`)
  if (context.currency) lines.push(`Currency: ${context.currency}`)
  if (context.incoterms) lines.push(`Incoterms: ${context.incoterms}`)
  if (context.delivery_location) lines.push(`Delivery location: ${context.delivery_location}`)
  if (context.delivery_deadline) lines.push(`Delivery deadline: ${context.delivery_deadline}`)
  if (context.payment_terms) lines.push(`Payment terms: ${context.payment_terms}`)
  if (context.line_items?.length) {
    lines.push('Line items:')
    for (const item of context.line_items) {
      lines.push(`  - ${item.name}${item.quantity ? ` — qty ${item.quantity}${item.unit ? ` ${item.unit}` : ''}` : ''}${item.unit_price ? ` @ ${item.currency ?? context.currency ?? 'USD'} ${item.unit_price}` : ''}${item.description ? ` (${item.description})` : ''}`)
    }
  }
  return lines.join('\n') || 'No structured details provided — draft a generic, clearly-labeled placeholder RFx.'
}

const DOC_LABELS: Record<RfxDocType, { name: string; sections: string[]; sectionHeaders: string[] }> = {
  rfx: {
    name: 'RFx',
    sections: ['scope', 'line item', 'commercial term', 'submission', 'evaluation criteria'],
    sectionHeaders: ['## Scope', '## Line Items & Specifications', '## Commercial Terms', '## Submission Instructions', '## Evaluation Criteria'],
  },
  invoice: {
    name: 'Invoice',
    sections: ['invoice number', 'bill to', 'line item', 'amount due', 'payment terms'],
    sectionHeaders: ['## Invoice Details', '## Bill To / Ship To', '## Line Items', '## Totals & Amount Due', '## Payment Terms'],
  },
}

export async function generateRfxDraft(context: RfxContext, docType: RfxDocType = 'rfx'): Promise<string> {
  const labels = DOC_LABELS[docType]
  const system = docType === 'invoice'
    ? 'You are a billing/invoicing drafting assistant. Draft clear, professional commercial invoices in markdown. Use section headers (##), a line-item table, and plain business English. No filler.'
    : 'You are a procurement drafting assistant. Draft clear, professional RFx (Request for Quotation/Proposal) documents in markdown. Use section headers (##), bullet lists for line items and requirements, and plain business English. No filler, no legal boilerplate beyond what is asked for.'

  const result = await callClaude({
    system,
    messages: [{
      role: 'user',
      content: `Draft a complete ${labels.name} document from the following details:

${formatContextForPrompt(context)}

Structure the document with these markdown sections, in order:
${labels.sectionHeaders.join('\n')}

Fill in reasonable, industry-standard defaults for anything not provided (e.g. a 2-week submission window, or an invoice date of today and Net 30 terms), but clearly mark any assumption with "(assumed)". Keep it under 700 words.`,
    }],
    max_tokens: 2048,
    model: 'claude-sonnet-4-6',
  })
  return result.text
}

// ── Evaluation / scoring ────────────────────────────────────────────────────

function deterministicScores(content: string, context: RfxContext, docType: RfxDocType = 'rfx'): Record<RfxSection, number> {
  const REQUIRED_SECTIONS = DOC_LABELS[docType].sections
  const lower = content.toLowerCase()
  const presentSections = REQUIRED_SECTIONS.filter(s => lower.includes(s)).length
  const completeness = Math.round((presentSections / REQUIRED_SECTIONS.length) * 100)

  const itemsWithPrice = (context.line_items ?? []).filter(i => i.unit_price != null && i.unit_price > 0).length
  const totalItems = context.line_items?.length ?? 0
  const competitiveness = totalItems > 0 ? Math.round((itemsWithPrice / totalItems) * 100) : 50

  const hasDeadline = !!context.delivery_deadline || /deadline|by \d{4}|submission.*(date|window)/i.test(content)
  const hasTerms = !!context.payment_terms || /payment terms/i.test(content)
  const pricing = itemsWithPrice > 0 ? 70 : 40

  const risk = 60 + (hasDeadline ? 15 : 0) + (hasTerms ? 15 : 0) - (totalItems === 0 ? 20 : 0)

  return {
    completeness: Math.min(100, Math.max(0, completeness)),
    competitiveness: Math.min(100, Math.max(0, competitiveness)),
    pricing: Math.min(100, Math.max(0, pricing)),
    risk: Math.min(100, Math.max(0, risk)),
  }
}

function deterministicFallback(content: string, context: RfxContext, docType: RfxDocType): RfxScoreResult {
  const section_scores = deterministicScores(content, context, docType)
  const values = Object.values(section_scores)
  const overall_score = Math.round(values.reduce((a, b) => a + b, 0) / values.length)
  return { overall_score, section_scores, highlights: [], ai_scored: false }
}

interface AiScoreResponse {
  overall_score: number
  section_scores: Record<string, number>
  highlights: Array<{ quote: string; section: string; severity: string; issue: string; suggestion: string }>
}

export async function scoreRfxContent(content: string, context: RfxContext, docType: RfxDocType = 'rfx'): Promise<RfxScoreResult> {
  const deterministic = deterministicScores(content, context, docType)
  const labels = DOC_LABELS[docType]

  try {
    const result = await callClaude({
      system: `You are a ${docType === 'invoice' ? 'billing/invoicing' : 'procurement'} quality reviewer. Always respond with valid JSON only — no prose, no markdown fences.`,
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Review this draft ${labels.name} document and score it.

--- BEGIN ${labels.name.toUpperCase()} DOCUMENT ---
${content.slice(0, 8000)}
--- END ${labels.name.toUpperCase()} DOCUMENT ---

Context: ${formatContextForPrompt(context)}

Score four dimensions 0-100, kept SEPARATE (never blend them into one number):
- completeness: are all required sections (${labels.sections.join(', ')}) present and specific?
- competitiveness: ${docType === 'invoice' ? 'is the invoice clear enough to avoid payment disputes or delays?' : 'is the document written in a way likely to attract strong supplier responses (clear specs, reasonable terms, no vague requirements)?'}
- pricing: are quantities/prices specified clearly and consistently (line items sum to the stated total)?
- risk: are there ambiguous, missing, or one-sided terms that could cause disputes later?

Also flag up to 6 specific weak or missing areas as highlights. Each highlight's "quote" must be a short (under 15 words) VERBATIM excerpt from the document above (or, if the issue is a missing section entirely, the nearest heading it should follow).

Respond with ONLY this JSON shape:
{
  "overall_score": <integer 0-100>,
  "section_scores": { "completeness": <0-100>, "competitiveness": <0-100>, "pricing": <0-100>, "risk": <0-100> },
  "highlights": [ { "quote": "...", "section": "...", "severity": "info|warning|critical", "issue": "...", "suggestion": "..." } ]
}`,
      }],
    })

    const parsed = extractJson<AiScoreResponse>(result.text)
    if (
      parsed &&
      typeof parsed.overall_score === 'number' &&
      parsed.overall_score >= 0 && parsed.overall_score <= 100 &&
      parsed.section_scores
    ) {
      const highlights: RfxHighlight[] = Array.isArray(parsed.highlights)
        ? parsed.highlights
            .filter(h => h?.quote && h?.issue)
            .slice(0, 6)
            .map(h => ({
              quote: String(h.quote),
              section: String(h.section ?? 'General'),
              severity: (['info', 'warning', 'critical'].includes(h.severity) ? h.severity : 'info') as HighlightSeverity,
              issue: String(h.issue),
              suggestion: String(h.suggestion ?? ''),
            }))
        : []

      return {
        overall_score: Math.round(parsed.overall_score),
        section_scores: {
          completeness: parsed.section_scores.completeness ?? deterministic.completeness,
          competitiveness: parsed.section_scores.competitiveness ?? deterministic.competitiveness,
          pricing: parsed.section_scores.pricing ?? deterministic.pricing,
          risk: parsed.section_scores.risk ?? deterministic.risk,
        },
        highlights,
        ai_scored: true,
      }
    }
  } catch {
    // fall through to deterministic fallback below
  }

  return deterministicFallback(content, context, docType)
}

// ── Pricing benchmark (delegates to the existing get_pricing_insights tool) ──

export async function benchmarkRfxPricing(context: RfxContext): Promise<{ price_assessment: RfxPriceAssessment | null; highlights: RfxHighlight[] }> {
  const items = (context.line_items ?? []).filter(i => i.name && i.unit_price != null)
  if (items.length === 0) return { price_assessment: null, highlights: [] }

  // Benchmark the highest-value line item — representative of the RFx's
  // overall pricing risk without paying for N separate lookups.
  const primary = items.reduce((a, b) => ((a.unit_price ?? 0) * (a.quantity ?? 1)) >= ((b.unit_price ?? 0) * (b.quantity ?? 1)) ? a : b)

  try {
    const insights = await getPricingInsights({
      product_name: primary.name,
      product_category: context.category,
      quantity: primary.quantity,
      unit: primary.unit,
      proposed_unit_price: primary.unit_price,
      currency: primary.currency ?? context.currency,
    })

    const verdict = insights.price_assessment?.verdict ?? null
    const delta = insights.price_assessment?.delta_from_platform_avg_pct ?? null
    const summaryParts: string[] = []
    if (insights.platform_benchmark?.sample_size) {
      summaryParts.push(`Platform average for "${primary.name}": ${insights.currency} ${insights.platform_benchmark.avg_unit_price}/unit across ${insights.platform_benchmark.sample_size} comparable Strike Listings.`)
    } else {
      summaryParts.push(`No comparable Strike Listings found for "${primary.name}" — benchmark is based on external market data only.`)
    }
    if (insights.external_market?.market_summary) summaryParts.push(insights.external_market.market_summary)

    const highlights: RfxHighlight[] = []
    if (verdict === 'above_market' || verdict === 'slightly_above') {
      highlights.push({
        quote: primary.name,
        section: 'Line Items & Specifications',
        severity: verdict === 'above_market' ? 'warning' : 'info',
        issue: `Target price for "${primary.name}" is ${delta != null ? `${delta}% ` : ''}above the platform/market benchmark.`,
        suggestion: 'Consider lowering the target price or clarifying quality/certification requirements that justify the premium.',
      })
    }

    return {
      price_assessment: { verdict, delta_from_platform_avg_pct: delta, summary: summaryParts.join(' ') },
      highlights,
    }
  } catch {
    return { price_assessment: null, highlights: [] }
  }
}
