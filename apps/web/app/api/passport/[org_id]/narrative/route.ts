import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { callClaude, AI_MODEL } from '@/lib/ai'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const DAY = 24 * 60 * 60 * 1000
const NARRATIVE_TTL = 7 * DAY

const NARRATIVE_SYSTEM =
  'You are Strike AI. Generate a 2-3 sentence professional Passport narrative for this organization. ' +
  'Be factual, direct, calibrated to a CFO audience. No marketing language. Use only the data provided.'

const ASSESSMENT_SYSTEM =
  'You are Strike AI. In 2-3 sentences, give a CFO-grade assessment of this organization relative to the ' +
  'network medians provided. State concretely where it sits above or below the median (score, payment days, ' +
  'dispute rate, trade volume). Be factual and direct. No marketing language. Use only the data provided.'

function median(nums: number[]): number | null {
  const vals = nums.filter(n => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b)
  if (vals.length === 0) return null
  const mid = Math.floor(vals.length / 2)
  // Length is > 0 here — non-null assertions are safe.
  return vals.length % 2 === 0 ? (vals[mid - 1]! + vals[mid]!) / 2 : vals[mid]!
}

function fallbackNarrative(org: Record<string, unknown>): string {
  const name = (org.doing_business_as || org.legal_name || 'This organization') as string
  const kind = org.type === 'anchor' ? 'buyer' : 'supplier'
  const years = org.years_in_operation ? `${org.years_in_operation} years in operation` : 'an emerging operating history'
  const trades = Number(org.trade_count_total ?? 0)
  const tradeStr = trades > 0 ? `${trades} completed trade${trades === 1 ? '' : 's'} on the network` : 'no completed trades on the network yet'
  return `${name} is a ${kind} with ${years} and ${tradeStr}. Its Strike Passport reflects the data verified during KYB; performance metrics will deepen as trade history accumulates.`
}

async function logUsage(usage: { input_tokens?: number; output_tokens?: number }, userId: string, orgId: string | null) {
  try {
    await adminClient.from('ai_usage').insert({
      user_id: userId,
      org_id: orgId,
      feature: 'insight',
      tokens_input: usage.input_tokens ?? 0,
      tokens_output: usage.output_tokens ?? 0,
      tokens_total: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
      model: AI_MODEL,
    })
  } catch {
    /* non-fatal */
  }
}

// GET /api/passport/[org_id]/narrative
// Returns the stored passport_narrative (regenerating it if missing or > 7 days old)
// plus a freshly generated assessment comparing the org to network medians.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ org_id: string }> }
) {
  const { org_id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, org_id, bank_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: org } = await adminClient
    .from('organizations')
    .select('*')
    .eq('id', org_id)
    .single()
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isOwn = me.org_id === org_id
  if (!isOwn && org.network_visible !== true) {
    return NextResponse.json({ error: 'This passport is private' }, { status: 403 })
  }

  const since12mo = new Date(Date.now() - 365 * DAY).toISOString()
  const [{ data: performance }, { count: recentDeals }, { data: peers }] = await Promise.all([
    adminClient
      .from('supplier_performance')
      .select('on_time_payment_rate, dispute_rate, avg_advance_rate, total_deals, total_deal_volume, performance_tier')
      .eq('org_id', org_id)
      .order('last_calculated_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    adminClient
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .or(`buyer_org_id.eq.${org_id},supplier_org_id.eq.${org_id}`)
      .gte('created_at', since12mo),
    adminClient
      .from('organizations')
      .select('passport_score, avg_payment_days, dispute_rate_network, trade_count_total')
      .eq('type', org.type)
      .eq('network_visible', true)
      .limit(1000),
  ])

  const medians = {
    passport_score: median((peers ?? []).map(p => Number(p.passport_score))),
    avg_payment_days: median((peers ?? []).map(p => Number(p.avg_payment_days))),
    dispute_rate_network: median((peers ?? []).map(p => Number(p.dispute_rate_network))),
    trade_count_total: median((peers ?? []).map(p => Number(p.trade_count_total))),
    peer_count: (peers ?? []).length,
  }

  const context = {
    legal_name: org.legal_name,
    doing_business_as: org.doing_business_as,
    type: org.type,
    business_type: org.business_type,
    industry_naics: org.industry_naics,
    years_in_operation: org.years_in_operation,
    annual_revenue_range: org.annual_revenue_range,
    employee_count_range: org.employee_count_range,
    country_of_origin: org.country_of_origin,
    sourcing_countries: org.sourcing_countries,
    product_categories: org.product_categories,
    kyb_status: org.kyb_status,
    passport_score: org.passport_score,
    performance_tier: org.performance_tier,
    trade_count_total: org.trade_count_total,
    trade_volume_total: org.trade_volume_total,
    avg_payment_days: org.avg_payment_days,
    dispute_rate_network: org.dispute_rate_network,
    on_time_payment_rate: performance?.on_time_payment_rate ?? null,
    dispute_rate: performance?.dispute_rate ?? null,
    recent_deals_12mo: recentDeals ?? 0,
  }

  // ── Narrative (cached on the org, refreshed when stale) ──────────────────
  let narrative: string | null = org.passport_narrative ?? null
  let narrativeUpdatedAt: string | null = org.passport_narrative_updated_at ?? null
  const stale =
    !narrative ||
    !narrativeUpdatedAt ||
    Date.now() - new Date(narrativeUpdatedAt).getTime() > NARRATIVE_TTL

  if (stale) {
    try {
      const res = await callClaude({
        system: NARRATIVE_SYSTEM,
        messages: [{ role: 'user', content: `Organization data:\n${JSON.stringify(context, null, 2)}` }],
        max_tokens: 256,
      })
      narrative = res.text.trim() || fallbackNarrative(org)
      narrativeUpdatedAt = new Date().toISOString()

      await adminClient
        .from('organizations')
        .update({
          passport_narrative: narrative,
          passport_narrative_updated_at: narrativeUpdatedAt,
          updated_at: narrativeUpdatedAt,
        })
        .eq('id', org_id)

      await logUsage(res.usage, me.id, isOwn ? org_id : null)
      try {
        await adminClient.from('agent_actions').insert({
          org_id,
          action_type: 'passport_narrative_generated',
          entity_type: 'organization',
          entity_id: org_id,
          reasoning: 'Passport narrative was missing or older than 7 days; regenerated from current org data.',
          output_summary: narrative.slice(0, 500),
          model: AI_MODEL,
          tokens_used: (res.usage.input_tokens ?? 0) + (res.usage.output_tokens ?? 0),
          requires_approval: false,
        })
      } catch {
        /* non-fatal */
      }
    } catch (e) {
      console.error('[passport/narrative] narrative generation failed:', e)
      if (!narrative) narrative = fallbackNarrative(org)
    }
  }

  // ── Fresh comparative assessment (not persisted) ─────────────────────────
  let assessment: string | null = null
  try {
    const res = await callClaude({
      system: ASSESSMENT_SYSTEM,
      messages: [{
        role: 'user',
        content: `This organization:\n${JSON.stringify(context, null, 2)}\n\nNetwork medians (same org type):\n${JSON.stringify(medians, null, 2)}`,
      }],
      max_tokens: 256,
    })
    assessment = res.text.trim() || null
    await logUsage(res.usage, me.id, isOwn ? org_id : null)
  } catch (e) {
    console.error('[passport/narrative] assessment generation failed:', e)
  }

  return NextResponse.json({
    narrative,
    narrative_updated_at: narrativeUpdatedAt,
    assessment,
    medians,
    is_own: isOwn,
  })
}
