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

  // Deals between the owner and its active members — reuses `deals`, no new
  // columns. A deal counts if it's between the owner and any member org, on
  // either side (buyer or supplier). Also used below to build the spend
  // trend and the per-member volume leaderboard.
  let dealCount = 0
  let dealVolume = 0
  const spendByMonth = Array.from({ length: 6 }, (_, i) => {
    const now = new Date()
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    return { label: d.toLocaleDateString('en-US', { month: 'short' }), start: d, end: new Date(now.getFullYear(), now.getMonth() - (5 - i) + 1, 1), amount: 0 }
  })
  const volumeByOrg = new Map<string, { deal_count: number; deal_volume: number }>()

  if (activeOrgIds.length > 0) {
    const orConditions = activeOrgIds
      .map(orgId => `and(buyer_org_id.eq.${network.anchor_org_id},supplier_org_id.eq.${orgId}),and(buyer_org_id.eq.${orgId},supplier_org_id.eq.${network.anchor_org_id})`)
      .join(',')
    const { data: deals } = await adminClient
      .from('deals')
      .select('buyer_org_id, supplier_org_id, total_value, agreed_price, status, created_at')
      .or(orConditions)
      .neq('status', 'cancelled')

    for (const d of (deals ?? [])) {
      const value = Number(d.total_value ?? d.agreed_price ?? 0)
      dealCount += 1
      dealVolume += value

      const createdAt = d.created_at ? new Date(d.created_at) : null
      if (createdAt) {
        const bucket = spendByMonth.find(b => createdAt >= b.start && createdAt < b.end)
        if (bucket) bucket.amount += value
      }

      const counterpartyOrgId = d.buyer_org_id === network.anchor_org_id ? d.supplier_org_id : d.buyer_org_id
      const cur = volumeByOrg.get(counterpartyOrgId) ?? { deal_count: 0, deal_volume: 0 }
      cur.deal_count += 1
      cur.deal_volume += value
      volumeByOrg.set(counterpartyOrgId, cur)
    }
  }

  const topOrgIds = [...volumeByOrg.entries()]
    .sort((a, b) => b[1].deal_volume - a[1].deal_volume)
    .slice(0, 6)
    .map(([orgId]) => orgId)

  let topCounterparties: { org_id: string; name: string; deal_count: number; deal_volume: number }[] = []
  if (topOrgIds.length > 0) {
    const { data: orgs } = await adminClient
      .from('organizations')
      .select('id, legal_name, doing_business_as')
      .in('id', topOrgIds)
    const nameMap = new Map((orgs ?? []).map(o => [o.id, o.doing_business_as || o.legal_name || 'Unknown']))
    topCounterparties = topOrgIds.map(orgId => ({
      org_id: orgId,
      name: nameMap.get(orgId) ?? 'Unknown',
      deal_count: volumeByOrg.get(orgId)!.deal_count,
      deal_volume: volumeByOrg.get(orgId)!.deal_volume,
    }))
  }

  return NextResponse.json({
    active_members: statusCounts.active ?? 0,
    active_listings: listingsCount ?? 0,
    active_listings_value: listingsValue,
    deal_count: dealCount,
    deal_volume: dealVolume,
    spend_by_month: spendByMonth.map(b => ({ label: b.label, amount: b.amount })),
    top_counterparties: topCounterparties,
  })
}
