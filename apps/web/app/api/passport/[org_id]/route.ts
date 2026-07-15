import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getOrgTradeStats } from '@/lib/passport/trade-stats'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Never leave the server on a passport payload.
const SENSITIVE_FIELDS = ['ein', 'bank_account_last4', 'bank_account_type', 'bank_routing_number']

const DAY = 24 * 60 * 60 * 1000

function maskEin(ein: string | null): string | null {
  if (!ein) return null
  const digits = ein.replace(/\D/g, '')
  if (digits.length < 4) return '**-*******'
  return `**-***${digits.slice(-4)}`
}

function median(nums: number[]): number | null {
  const vals = nums.filter(n => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b)
  if (vals.length === 0) return null
  const mid = Math.floor(vals.length / 2)
  // Length is > 0 here — non-null assertions are safe.
  return vals.length % 2 === 0 ? (vals[mid - 1]! + vals[mid]!) / 2 : vals[mid]!
}

// GET /api/passport/[org_id] — full passport profile.
// Visible when the org has network_visible = true OR it's the caller's own org.
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
    .select('id, role, org_id, bank_id')
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

  const since30 = new Date(Date.now() - 30 * DAY).toISOString()
  const since12mo = new Date(Date.now() - 365 * DAY).toISOString()

  const [
    { data: reviews },
    { data: performance },
    { data: views },
    { count: recentDeals },
    { data: peers },
    tradeStats,
  ] = await Promise.all([
    adminClient
      .from('passport_peer_reviews')
      .select('id, reviewing_org_id, rating, category_scores, comment, created_at')
      .eq('reviewed_org_id', org_id)
      .eq('is_public', true)
      .order('created_at', { ascending: false }),
    adminClient
      .from('supplier_performance')
      .select('*')
      .eq('org_id', org_id)
      .order('last_calculated_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    adminClient
      .from('passport_views')
      .select('viewer_org_id, viewer_bank_id')
      .eq('viewed_org_id', org_id)
      .gte('created_at', since30)
      .limit(2000),
    adminClient
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .or(`buyer_org_id.eq.${org_id},supplier_org_id.eq.${org_id}`)
      .gte('created_at', since12mo),
    adminClient
      .from('organizations')
      .select('passport_score')
      .eq('type', org.type)
      .eq('network_visible', true)
      .not('passport_score', 'is', null)
      .limit(1000),
    // organizations.trade_count_total / trade_volume_total / avg_payment_days /
    // dispute_rate_network are never written by any deal lifecycle path, so
    // they're computed live here instead of trusted as-is (see lib/passport/trade-stats.ts).
    getOrgTradeStats(adminClient, org_id),
  ])

  // Attach reviewer display names.
  const reviewerIds = [...new Set((reviews ?? []).map(r => r.reviewing_org_id).filter(Boolean))]
  let reviewerNames: Record<string, string> = {}
  if (reviewerIds.length > 0) {
    const { data: reviewerOrgs } = await adminClient
      .from('organizations')
      .select('id, legal_name, doing_business_as')
      .in('id', reviewerIds)
    reviewerNames = Object.fromEntries(
      (reviewerOrgs ?? []).map(o => [o.id, o.doing_business_as || o.legal_name || 'Counterparty'])
    )
  }

  const reviewList = (reviews ?? []).map(r => ({
    id: r.id,
    rating: r.rating,
    category_scores: r.category_scores,
    comment: r.comment,
    created_at: r.created_at,
    reviewer_name: reviewerNames[r.reviewing_org_id] ?? 'Counterparty',
  }))

  const ratings = reviewList.map(r => Number(r.rating)).filter(n => Number.isFinite(n))
  const avgRating = ratings.length > 0
    ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
    : null

  // Distinct viewer counts over the last 30 days, split by viewer type.
  const bankViewers = new Set<string>()
  const orgViewers = new Set<string>()
  for (const v of views ?? []) {
    if (v.viewer_bank_id) bankViewers.add(v.viewer_bank_id)
    else if (v.viewer_org_id && v.viewer_org_id !== org_id) orgViewers.add(v.viewer_org_id)
  }

  // Live trade-activity metrics — computed from the deals table on every
  // request so they always reflect current activity (see comment above).
  const tradeCountTotal = tradeStats.trade_count_total
  const tradeVolumeTotal = tradeStats.trade_volume_total
  const avgPaymentDays = tradeStats.avg_payment_days
  const onTimePaymentRate = tradeStats.on_time_payment_rate
  const disputeRate = tradeStats.dispute_rate_network != null
    ? Math.round(tradeStats.dispute_rate_network * 100)
    : null

  // Strip sensitive fields; expose a masked EIN to the owning org only.
  const safeOrg: Record<string, unknown> = { ...org }
  for (const f of SENSITIVE_FIELDS) delete safeOrg[f]
  safeOrg.ein_masked = isOwn ? maskEin(org.ein) : null
  safeOrg.trade_count_total = tradeCountTotal
  safeOrg.trade_volume_total = tradeVolumeTotal
  safeOrg.avg_payment_days = avgPaymentDays

  const livePerformance = {
    ...(performance ?? {}),
    org_id,
    on_time_payment_rate: onTimePaymentRate,
    dispute_rate: disputeRate,
  }

  return NextResponse.json({
    organization: safeOrg,
    is_own: isOwn,
    peer_reviews: reviewList,
    avg_rating: avgRating,
    review_count: reviewList.length,
    supplier_performance: livePerformance,
    recent_deals: recentDeals ?? 0,
    bank_view_count_30d: bankViewers.size,
    org_view_count_30d: orgViewers.size,
    network_passport_score_median: median((peers ?? []).map(p => Number(p.passport_score))),
  })
}

// PATCH /api/passport/[org_id] — owning org toggles "Visible on Strike Place".
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ org_id: string }> }
) {
  const { org_id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (me.org_id !== org_id) {
    return NextResponse.json({ error: 'You can only update your own passport' }, { status: 403 })
  }

  let body: { network_visible?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body.network_visible !== 'boolean') {
    return NextResponse.json({ error: 'network_visible (boolean) is required' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {
    network_visible: body.network_visible,
    updated_at: new Date().toISOString(),
  }
  // First time made visible, stamp the publish date.
  if (body.network_visible) patch.passport_published_at = new Date().toISOString()

  const { error } = await adminClient
    .from('organizations')
    .update(patch)
    .eq('id', org_id)

  if (error) return NextResponse.json({ error: 'Failed to update passport' }, { status: 500 })

  return NextResponse.json({ success: true, network_visible: body.network_visible })
}
