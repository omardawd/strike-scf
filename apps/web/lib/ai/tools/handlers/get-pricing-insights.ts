import { adminClient } from '../admin'

export interface GetPricingInsightsInput {
  product_name: string
  product_category?: string
  specs?: Record<string, unknown>
  quantity?: number
  unit?: string
  proposed_unit_price?: number
  currency?: string
  buyer_org_id?: string
  supplier_org_id?: string
  delivery_location?: string
  look_back_months?: number
}

interface ExternalPricingResult {
  source: string
  index_price_range: string | null
  trend_30d: string | null
  key_factors: string[]
  relevant_indices: string[]
  raw_summary: string
}

async function searchExternalPricing(product: string, category: string | undefined): Promise<ExternalPricingResult> {
  const prompt =
    `You are a commodity pricing analyst. Provide current market pricing for: "${product}"` +
    (category ? ` (category: ${category})` : '') +
    `. Return JSON with: index_price_range (e.g. "$X-$Y per unit"), trend_30d ("rising"/"falling"/"stable"), ` +
    `key_factors (array of 3-5 current market drivers: supply chain, tariffs, demand, etc.), ` +
    `relevant_indices (applicable commodity indices: LME, CME, FAO, ICE, etc.), ` +
    `summary (2-3 sentence market outlook). Only return valid JSON.`

  // Try with web search first
  const webSearchBody = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    messages: [{ role: 'user', content: prompt }],
  })

  let text = ''
  let source = 'knowledge_base'

  const wsRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-beta': 'web-search-2025-03-05',
    },
    body: webSearchBody,
  }).catch(() => null)

  if (wsRes?.ok) {
    const data = await wsRes.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textBlock = data?.content?.find((b: any) => b.type === 'text')
    text = textBlock?.text ?? ''
    source = 'web_search'
  } else {
    // Fallback: knowledge-base only (no web search)
    const kbRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
    }).catch(() => null)

    if (kbRes?.ok) {
      const data = await kbRes.json()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      text = data?.content?.find((b: any) => b.type === 'text')?.text ?? ''
    }
  }

  if (!text) {
    return { source, index_price_range: null, trend_30d: null, key_factors: [], relevant_indices: [], raw_summary: 'External pricing data unavailable.' }
  }

  try {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
    const jsonStr = fenced ?? text
    const start = jsonStr.indexOf('{')
    const end = jsonStr.lastIndexOf('}')
    if (start !== -1 && end !== -1) {
      const parsed = JSON.parse(jsonStr.slice(start, end + 1))
      return {
        source,
        index_price_range: parsed.index_price_range ?? null,
        trend_30d: parsed.trend_30d ?? null,
        key_factors: Array.isArray(parsed.key_factors) ? parsed.key_factors : [],
        relevant_indices: Array.isArray(parsed.relevant_indices) ? parsed.relevant_indices : [],
        raw_summary: parsed.summary ?? text.slice(0, 500),
      }
    }
  } catch { /* ignore parse errors */ }

  return { source, index_price_range: null, trend_30d: null, key_factors: [], relevant_indices: [], raw_summary: text.slice(0, 500) }
}

function monthsAgo(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString()
}

export async function getPricingInsights(input: GetPricingInsightsInput) {
  const lookBack = input.look_back_months ?? 6
  const since = monthsAgo(lookBack)
  const currency = input.currency ?? 'USD'

  const [{ data: lineItemComps }, { data: cachedSignals }] = await Promise.all([
    adminClient
      .from('listing_line_items')
      .select('name, unit_price, unit, quantity, currency, created_at')
      .ilike('name', `%${input.product_name}%`)
      .not('unit_price', 'is', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(30),
    adminClient
      .from('market_signals')
      .select('signal_type, commodity, value, metadata, source, fetched_at')
      .ilike('commodity', `%${input.product_name}%`)
      .order('fetched_at', { ascending: false })
      .limit(5),
  ])

  const validComps = (lineItemComps ?? []).filter((c: { unit_price: number | null }) => c.unit_price != null)
  let internalAvg: number | null = null
  let internalMin: number | null = null
  let internalMax: number | null = null

  if (validComps.length > 0) {
    const prices = validComps.map((c: { unit_price: number }) => Number(c.unit_price))
    internalAvg = Math.round((prices.reduce((a: number, b: number) => a + b, 0) / prices.length) * 100) / 100
    internalMin = Math.min(...prices)
    internalMax = Math.max(...prices)
  }

  let priceAssessment: string | null = null
  let priceDeltaPct: number | null = null
  if (input.proposed_unit_price && internalAvg) {
    priceDeltaPct = Math.round(((input.proposed_unit_price - internalAvg) / internalAvg) * 1000) / 10
    if (priceDeltaPct > 15) priceAssessment = 'above_market'
    else if (priceDeltaPct > 5) priceAssessment = 'slightly_above'
    else if (priceDeltaPct < -15) priceAssessment = 'below_market'
    else if (priceDeltaPct < -5) priceAssessment = 'slightly_below'
    else priceAssessment = 'at_market'
  }

  const external = await searchExternalPricing(input.product_name, input.product_category)

  const tactics: string[] = []
  if (priceAssessment === 'above_market') {
    tactics.push(`Platform data shows average ${currency} ${internalAvg}/unit — use this to negotiate down.`)
  }
  if (priceAssessment === 'below_market') {
    tactics.push('Proposed price is below platform average — verify quality standards before accepting.')
  }
  if (external.trend_30d === 'rising') {
    tactics.push('Market is trending upward — locking in price now may be advantageous for the buyer.')
  }
  if (external.trend_30d === 'falling') {
    tactics.push('Market is softening — buyer has leverage to negotiate a lower price or delayed delivery.')
  }
  if (external.key_factors.some((f: string) => f.toLowerCase().includes('tariff'))) {
    tactics.push('Tariff risk noted — clarify incoterms (DDP vs. DAP) to allocate tariff exposure clearly.')
  }
  if (!tactics.length) {
    tactics.push('Price appears reasonable. Focus negotiation on payment terms and delivery guarantees.')
  }

  if (external.index_price_range && external.source === 'web_search') {
    adminClient.from('market_signals').insert({
      signal_type: 'commodity_price',
      commodity: input.product_name,
      value: null,
      metadata: { price_range: external.index_price_range, trend: external.trend_30d, key_factors: external.key_factors, indices: external.relevant_indices, summary: external.raw_summary },
      source: 'web_search_anthropic',
    }).then(() => {}).catch(() => {})
  }

  return {
    product: input.product_name,
    category: input.product_category,
    currency,
    proposed_unit_price: input.proposed_unit_price ?? null,
    platform_benchmark: {
      avg_unit_price: internalAvg,
      min_unit_price: internalMin,
      max_unit_price: internalMax,
      sample_size: validComps.length,
      look_back_months: lookBack,
      comparable_listings: validComps.slice(0, 5).map((c: { name: string; unit_price: number; unit: string; currency: string; created_at: string }) => ({
        name: c.name, unit_price: c.unit_price, unit: c.unit, currency: c.currency, date: c.created_at,
      })),
    },
    external_market: {
      source: external.source,
      index_price_range: external.index_price_range,
      trend_30d: external.trend_30d,
      key_factors: external.key_factors,
      relevant_indices: external.relevant_indices,
      market_summary: external.raw_summary,
    },
    cached_signals: (cachedSignals ?? []).map((s: { commodity: string; value: number; metadata: unknown; source: string; fetched_at: string }) => ({
      commodity: s.commodity, value: s.value, metadata: s.metadata, source: s.source, fetched_at: s.fetched_at,
    })),
    price_assessment: { verdict: priceAssessment, delta_from_platform_avg_pct: priceDeltaPct },
    negotiation_tactics: tactics,
  }
}
