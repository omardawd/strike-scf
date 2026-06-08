import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// G3.11 — GET /api/networks/supplier — supplier's network memberships
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  if (!['org_admin', 'org_member'].includes(me.role) || !me.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: memberships, error } = await adminClient
    .from('anchor_network_members')
    .select('id, network_id, status, invited_at, joined_at')
    .eq('supplier_org_id', me.org_id)
    .not('status', 'in', '("removed")')
    .order('invited_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  const networkIds = (memberships ?? []).map((m: { network_id: string }) => m.network_id)
  const networksMap: Record<string, any> = {}
  const anchorOrgIds: string[] = []

  if (networkIds.length > 0) {
    const { data: networks } = await adminClient
      .from('anchor_networks')
      .select('id, name, description, anchor_org_id')
      .in('id', networkIds)

    for (const n of networks ?? []) {
      networksMap[n.id] = n
      anchorOrgIds.push(n.anchor_org_id)
    }
  }

  const anchorOrgsMap: Record<string, any> = {}
  if (anchorOrgIds.length > 0) {
    const { data: anchors } = await adminClient
      .from('organizations')
      .select('id, legal_name, passport_score, country, created_at')
      .in('id', [...new Set(anchorOrgIds)])

    for (const a of anchors ?? []) anchorOrgsMap[a.id] = a
  }

  // Count active listings per network accessible to this supplier
  const listingCountsMap: Record<string, number> = {}
  if (networkIds.length > 0) {
    for (const nid of networkIds) {
      const { count } = await adminClient
        .from('marketplace_listings')
        .select('id', { count: 'exact', head: true })
        .eq('network_id', nid)
        .eq('status', 'active')
        .eq('visibility', 'network_only')
      listingCountsMap[nid] = count ?? 0
    }
  }

  // Sort: active first, then invited, then others
  const statusOrder: Record<string, number> = { active: 0, invited: 1, suspended: 2, declined: 3 }
  const sorted = [...(memberships ?? [])].sort((a: any, b: any) => {
    return (statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5)
  })

  const result = sorted.map((m: any) => {
    const network = networksMap[m.network_id] ?? null
    const anchor  = network ? (anchorOrgsMap[network.anchor_org_id] ?? null) : null
    return {
      membership: {
        id:         m.id,
        status:     m.status,
        invited_at: m.invited_at,
        joined_at:  m.joined_at,
      },
      network: network ? {
        id:          network.id,
        name:        network.name,
        description: network.description,
      } : null,
      anchor: anchor ? {
        id:           anchor.id,
        legal_name:   anchor.legal_name,
        passport_score: anchor.passport_score,
        country:      anchor.country,
      } : null,
      pending_listings_count: m.status === 'active' ? (listingCountsMap[m.network_id] ?? 0) : 0,
    }
  })

  return NextResponse.json({ networks: result })
}
