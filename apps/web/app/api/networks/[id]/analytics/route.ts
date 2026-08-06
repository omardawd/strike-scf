import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getNetworkAccess } from '@/lib/networks/access'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/networks/[id]/analytics — owner or active member. Everything here
// is computed live from anchor_network_members / marketplace_listings / deals
// — there are no rollup columns on anchor_networks yet, so this doesn't scale
// past a few hundred members without moving to trigger-maintained counters.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'User not found' }, { status: 401 })
  if (!me.org_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { network, hasAccess } = await getNetworkAccess(adminClient, id, me.org_id)
  if (!network) return NextResponse.json({ error: 'Network not found' }, { status: 404 })
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: members } = await adminClient
    .from('anchor_network_members')
    .select('supplier_org_id, status, joined_at')
    .eq('network_id', id)

  const memberRows = members ?? []
  const statusCounts = { active: 0, invited: 0, suspended: 0, declined: 0, removed: 0 } as Record<string, number>
  for (const m of memberRows) statusCounts[m.status] = (statusCounts[m.status] ?? 0) + 1

  const activeOrgIds = memberRows.filter(m => m.status === 'active').map(m => m.supplier_org_id)

  let avgPassportScore: number | null = null
  const scoreBuckets: Record<string, number> = { '0-44': 0, '45-69': 0, '70-100': 0 }
  if (activeOrgIds.length > 0) {
    const { data: orgs } = await adminClient
      .from('organizations')
      .select('passport_score')
      .in('id', activeOrgIds)
    const scores = (orgs ?? []).map(o => o.passport_score).filter((s): s is number => s != null)
    if (scores.length > 0) {
      avgPassportScore = Math.round((scores.reduce((s, n) => s + n, 0) / scores.length) * 10) / 10
      for (const s of scores) {
        if (s >= 70) scoreBuckets['70-100'] = (scoreBuckets['70-100'] ?? 0) + 1
        else if (s >= 45) scoreBuckets['45-69'] = (scoreBuckets['45-69'] ?? 0) + 1
        else scoreBuckets['0-44'] = (scoreBuckets['0-44'] ?? 0) + 1
      }
    }
  }

  const { count: listingsCount } = await adminClient
    .from('marketplace_listings')
    .select('id', { count: 'exact', head: true })
    .eq('network_id', id)
    .eq('status', 'active')

  const { data: listingValues } = await adminClient
    .from('marketplace_listings')
    .select('target_price')
    .eq('network_id', id)
    .eq('status', 'active')
  const listingsValue = (listingValues ?? []).reduce((s, l) => s + Number(l.target_price ?? 0), 0)

  // Deal volume/count between the owner and its active members — reuses
  // `deals`, no new columns. A deal counts if it's between the owner and any
  // member org, on either side (buyer or supplier).
  let dealCount = 0
  let dealVolume = 0
  if (activeOrgIds.length > 0) {
    const orConditions = activeOrgIds
      .map(orgId => `and(buyer_org_id.eq.${network.anchor_org_id},supplier_org_id.eq.${orgId}),and(buyer_org_id.eq.${orgId},supplier_org_id.eq.${network.anchor_org_id})`)
      .join(',')
    const { data: deals } = await adminClient
      .from('deals')
      .select('total_value, agreed_price, status')
      .or(orConditions)
      .neq('status', 'cancelled')
    dealCount = deals?.length ?? 0
    dealVolume = (deals ?? []).reduce((s, d) => s + Number(d.total_value ?? d.agreed_price ?? 0), 0)
  }

  // Member growth — active members bucketed by join month, last 6 months.
  const now = new Date()
  const growthBuckets = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const end = new Date(now.getFullYear(), now.getMonth() - (5 - i) + 1, 1)
    const label = d.toLocaleDateString('en-US', { month: 'short' })
    const count = memberRows.filter(m => {
      if (!m.joined_at) return false
      const joined = new Date(m.joined_at)
      return joined >= d && joined < end
    }).length
    return { label, count }
  })

  return NextResponse.json({
    member_counts: statusCounts,
    avg_passport_score: avgPassportScore,
    score_distribution: scoreBuckets,
    active_listings: listingsCount ?? 0,
    active_listings_value: listingsValue,
    deal_count: dealCount,
    deal_volume: dealVolume,
    member_growth: growthBuckets,
  })
}
