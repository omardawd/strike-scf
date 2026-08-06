import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getNetworkAccess } from '@/lib/networks/access'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// G3.5 — GET /api/networks/[id]/members — owner or active member
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

  if (!['org_admin', 'org_member'].includes(me.role) || !me.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Owner sees the roster; any active member does too — they already share a
  // private network room together, so gating the read-only roster more
  // strictly than that room would be inconsistent.
  const { network, hasAccess } = await getNetworkAccess(adminClient, id, me.org_id)
  if (!network) return NextResponse.json({ error: 'Network not found' }, { status: 404 })
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: members, error } = await adminClient
    .from('anchor_network_members')
    .select('*')
    .eq('network_id', id)
    .order('status', { ascending: true })
    .order('joined_at', { ascending: true })

  if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  const memberList = members ?? []
  const orgIds = memberList.map((m: { supplier_org_id: string }) => m.supplier_org_id)
  const orgsMap: Record<string, any> = {}

  if (orgIds.length > 0) {
    const { data: orgs } = await adminClient
      .from('organizations')
      .select('id, legal_name, passport_score, kyb_status, country, logo_url')
      .in('id', orgIds)
    for (const o of orgs ?? []) orgsMap[o.id] = o
  }

  // Sort: active first, then invited, then others
  const statusOrder: Record<string, number> = { active: 0, invited: 1, suspended: 2, declined: 3, removed: 4 }
  const sorted = [...memberList].sort((a: any, b: any) => {
    const aOrder = statusOrder[a.status] ?? 5
    const bOrder = statusOrder[b.status] ?? 5
    return aOrder - bOrder
  })

  const result = sorted.map((m: any) => ({
    ...m,
    organization: orgsMap[m.supplier_org_id] ?? null,
  }))

  return NextResponse.json({ members: result })
}
