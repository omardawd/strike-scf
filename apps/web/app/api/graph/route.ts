import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES = ['bank_admin', 'bank_credit_officer']

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, bank_id, org_id')
    .eq('id', user.id)
    .single()

  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })
  if (!BANK_ROLES.includes(userData.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const bankId = userData.bank_id

  const { data: bank } = await adminClient
    .from('banks')
    .select('id, display_name')
    .eq('id', bankId)
    .single()

  const bankLabel = bank?.display_name ?? 'Bank'
  const bankNode = { id: bankId, type: 'bank' as const, label: bankLabel, risk_tier: null }

  // Get all programs for this bank
  const { data: programs } = await adminClient
    .from('programs')
    .select('id, name, financing_types, status')
    .eq('bank_id', bankId)

  const programIds = (programs ?? []).map((p: { id: string }) => p.id)

  if (programIds.length === 0) {
    return NextResponse.json({
      nodes: [bankNode],
      edges: [],
      stats: { total_anchors: 0, total_suppliers: 0, total_volume: 0, at_risk_count: 0 },
    })
  }

  // Build graph from live enrollment data, including onboarding suppliers
  const { data: enrollmentsRaw } = await adminClient
    .from('program_enrollments')
    .select('program_id, org_id, anchor_org_id, status')
    .in('program_id', programIds)
    .in('status', ['active', 'onboarding'])

  const enrollments = enrollmentsRaw ?? []

  // Collect unique anchor and supplier org IDs from enrollment records
  const anchorOrgIdSet = new Set<string>()
  const supplierOrgIdSet = new Set<string>()

  for (const e of enrollments) {
    if (!e.anchor_org_id) continue
    anchorOrgIdSet.add(e.anchor_org_id)
    if (e.org_id !== e.anchor_org_id) {
      supplierOrgIdSet.add(e.org_id)
    }
  }

  const allOrgIds = [...new Set([...anchorOrgIdSet, ...supplierOrgIdSet])]

  type OrgRow = { id: string; legal_name: string; risk_tier: string | null; risk_score: number | null; country_of_origin: string | null; kyb_status: string | null; performance_tier: string | null }
  type EdgeRow = { from_org_id: string; to_org_id: string; program_id: string; transaction_count: number | null; total_volume: number | null }

  const [orgsResult, existingEdgesResult, txnsResult] = await Promise.all([
    allOrgIds.length > 0
      ? adminClient
          .from('organizations')
          .select('id, legal_name, risk_tier, risk_score, country_of_origin, kyb_status, performance_tier')
          .in('id', allOrgIds)
      : Promise.resolve({ data: [] as OrgRow[] }),
    adminClient
      .from('supply_graph_edges')
      .select('from_org_id, to_org_id, program_id, transaction_count, total_volume')
      .in('program_id', programIds),
    adminClient
      .from('transactions')
      .select('supplier_id, anchor_id')
      .in('program_id', programIds),
  ])

  const orgs = (orgsResult.data ?? []) as OrgRow[]
  const existingEdges = (existingEdgesResult.data ?? []) as EdgeRow[]
  const txns = txnsResult.data ?? []

  const orgMap = new Map(orgs.map(o => [o.id, o]))

  const txnCountByOrg: Record<string, number> = {}
  for (const t of txns) {
    if (t.supplier_id) txnCountByOrg[t.supplier_id] = (txnCountByOrg[t.supplier_id] ?? 0) + 1
    if (t.anchor_id) txnCountByOrg[t.anchor_id] = (txnCountByOrg[t.anchor_id] ?? 0) + 1
  }

  const nodes: Array<Record<string, unknown>> = [bankNode]
  const nodeMap: Record<string, boolean> = { [bankId]: true }
  const edges: Array<Record<string, unknown>> = []

  // Anchor nodes + bank→anchor edges
  for (const anchorId of anchorOrgIdSet) {
    if (nodeMap[anchorId]) continue
    const org = orgMap.get(anchorId)
    nodes.push({
      id: anchorId,
      type: 'anchor',
      label: org?.legal_name ?? anchorId,
      risk_tier: org?.risk_tier ?? null,
      risk_score: org?.risk_score ?? null,
      country: org?.country_of_origin ?? null,
      country_of_origin: org?.country_of_origin ?? null,
      kyb_status: org?.kyb_status ?? null,
      performance_tier: org?.performance_tier ?? null,
      transaction_count: txnCountByOrg[anchorId] ?? 0,
    })
    nodeMap[anchorId] = true
    edges.push({ from: bankId, to: anchorId, type: 'funds' })
  }

  // Supplier nodes + anchor→supplier edges, then cache to supply_graph_edges
  const edgeSet = new Set<string>()
  const upsertPayload: Array<Record<string, unknown>> = []

  for (const e of enrollments) {
    if (!e.anchor_org_id || e.org_id === e.anchor_org_id) continue
    const orgId = e.org_id

    if (!nodeMap[orgId]) {
      const org = orgMap.get(orgId)
      nodes.push({
        id: orgId,
        type: 'supplier',
        label: org?.legal_name ?? orgId,
        risk_tier: org?.risk_tier ?? null,
        risk_score: org?.risk_score ?? null,
        country: org?.country_of_origin ?? null,
        country_of_origin: org?.country_of_origin ?? null,
        kyb_status: org?.kyb_status ?? null,
        performance_tier: org?.performance_tier ?? null,
        transaction_count: txnCountByOrg[orgId] ?? 0,
      })
      nodeMap[orgId] = true
    }

    const edgeKey = `${e.anchor_org_id}:${orgId}`
    if (!edgeSet.has(edgeKey)) {
      edgeSet.add(edgeKey)
      const existingEdge = existingEdges.find(
        ex => ex.from_org_id === e.anchor_org_id && ex.to_org_id === orgId
      )
      edges.push({
        from: e.anchor_org_id,
        to: orgId,
        type: 'buys_from',
        transaction_count: existingEdge?.transaction_count ?? txnCountByOrg[orgId] ?? 0,
        total_volume: existingEdge?.total_volume ?? 0,
      })
    }

    upsertPayload.push({
      from_org_id: e.anchor_org_id,
      to_org_id: orgId,
      edge_type: 'buys_from',
      program_id: e.program_id,
      transaction_count: txnCountByOrg[orgId] ?? 0,
      total_volume: existingEdges.find(
        ex => ex.from_org_id === e.anchor_org_id && ex.to_org_id === orgId && ex.program_id === e.program_id
      )?.total_volume ?? 0,
    })
  }

  if (upsertPayload.length > 0) {
    adminClient
      .from('supply_graph_edges')
      .upsert(upsertPayload, { onConflict: 'from_org_id,to_org_id,program_id' })
      .then(() => {}, () => {})
  }

  const atRiskCount = nodes.filter(n => n.type === 'supplier' && n.risk_tier === 'red').length
  const totalVolume = existingEdges.reduce((s, e) => s + (e.total_volume ?? 0), 0)

  return NextResponse.json({
    nodes,
    edges,
    stats: {
      total_anchors: anchorOrgIdSet.size,
      total_suppliers: supplierOrgIdSet.size,
      total_volume: totalVolume,
      at_risk_count: atRiskCount,
    },
  })
}
