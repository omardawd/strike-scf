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
    .select('id, name')
    .eq('id', bankId)
    .single()

  const bankLabel = bank?.name ?? 'Bank'
  const bankNode = { id: bankId, type: 'bank' as const, label: bankLabel, risk_tier: null }

  const { data: programs } = await adminClient
    .from('programs')
    .select('id, name, anchor_org_id')
    .eq('bank_id', bankId)

  const programIds = (programs ?? []).map((p: { id: string }) => p.id)

  if (programIds.length === 0) {
    return NextResponse.json({
      nodes: [bankNode],
      edges: [],
      stats: { total_anchors: 0, total_suppliers: 0, total_volume: 0, at_risk_count: 0 },
    })
  }

  const programAnchorMap: Record<string, string> = {}
  for (const program of (programs ?? [])) {
    if (program.anchor_org_id) {
      programAnchorMap[program.id] = program.anchor_org_id
    }
  }

  const anchorOrgIds = new Set(Object.values(programAnchorMap))

  const [enrollmentsResult, existingEdgesResult, txnsResult] = await Promise.all([
    adminClient
      .from('program_enrollments')
      .select('id, program_id, org_id, status, organizations(id, legal_name, risk_tier, risk_score, country_of_origin)')
      .in('program_id', programIds)
      .eq('status', 'active'),
    adminClient
      .from('supply_graph_edges')
      .select('from_org_id, to_org_id, program_id, transaction_count, total_volume')
      .in('program_id', programIds),
    adminClient
      .from('transactions')
      .select('supplier_id, anchor_id')
      .in('program_id', programIds),
  ])

  const enrollments = enrollmentsResult.data ?? []
  const existingEdges = existingEdgesResult.data ?? []
  const txns = txnsResult.data ?? []

  const txnCountByOrg: Record<string, number> = {}
  for (const t of txns) {
    if (t.supplier_id) txnCountByOrg[t.supplier_id] = (txnCountByOrg[t.supplier_id] ?? 0) + 1
    if (t.anchor_id) txnCountByOrg[t.anchor_id] = (txnCountByOrg[t.anchor_id] ?? 0) + 1
  }

  const anchorOrgsData: Record<string, { id: string; legal_name: string; risk_tier: string | null; risk_score: number | null; country_of_origin: string | null }> = {}
  if (anchorOrgIds.size > 0) {
    const { data: anchorOrgs } = await adminClient
      .from('organizations')
      .select('id, legal_name, risk_tier, risk_score, country_of_origin')
      .in('id', Array.from(anchorOrgIds))
    for (const o of (anchorOrgs ?? [])) {
      anchorOrgsData[o.id] = o
    }
  }

  const nodes: Array<Record<string, unknown>> = [bankNode]
  const nodeMap: Record<string, boolean> = { [bankId]: true }
  const edges: Array<Record<string, unknown>> = []

  for (const anchorId of anchorOrgIds) {
    const org = anchorOrgsData[anchorId]
    if (!org || nodeMap[anchorId]) continue
    nodes.push({
      id: anchorId,
      type: 'anchor',
      label: org.legal_name,
      risk_tier: org.risk_tier,
      risk_score: org.risk_score,
      country: org.country_of_origin,
      transaction_count: txnCountByOrg[anchorId] ?? 0,
    })
    nodeMap[anchorId] = true

    for (const program of (programs ?? [])) {
      if (program.anchor_org_id === anchorId) {
        edges.push({ from: bankId, to: anchorId, type: 'funds', label: program.name })
      }
    }
  }

  const supplierOrgIds = new Set<string>()
  const edgeSet = new Set<string>()
  const upsertPayload: Array<Record<string, unknown>> = []

  for (const enrollment of enrollments) {
    const raw = enrollment.organizations
    const orgData = (Array.isArray(raw) ? raw[0] : raw) as {
      id: string; legal_name: string; risk_tier: string | null; risk_score: number | null; country_of_origin: string | null
    } | null
    if (!orgData) continue

    const orgId = enrollment.org_id
    if (anchorOrgIds.has(orgId)) continue

    supplierOrgIds.add(orgId)

    if (!nodeMap[orgId]) {
      nodes.push({
        id: orgId,
        type: 'supplier',
        label: orgData.legal_name,
        risk_tier: orgData.risk_tier,
        risk_score: orgData.risk_score,
        country: orgData.country_of_origin,
        transaction_count: txnCountByOrg[orgId] ?? 0,
      })
      nodeMap[orgId] = true
    }

    const anchorId = programAnchorMap[enrollment.program_id]
    if (!anchorId) continue

    const edgeKey = `${anchorId}:${orgId}`
    if (!edgeSet.has(edgeKey)) {
      edgeSet.add(edgeKey)
      const existingEdge = existingEdges.find(
        e => e.from_org_id === anchorId && e.to_org_id === orgId
      )
      edges.push({
        from: anchorId,
        to: orgId,
        type: 'buys_from',
        transaction_count: existingEdge?.transaction_count ?? txnCountByOrg[orgId] ?? 0,
        total_volume: existingEdge?.total_volume ?? 0,
      })
    }

    upsertPayload.push({
      from_org_id: anchorId,
      to_org_id: orgId,
      edge_type: 'buys_from',
      program_id: enrollment.program_id,
      transaction_count: txnCountByOrg[orgId] ?? 0,
      total_volume: existingEdges.find(e => e.from_org_id === anchorId && e.to_org_id === orgId && e.program_id === enrollment.program_id)?.total_volume ?? 0,
      risk_weight: orgData.risk_score,
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
      total_anchors: anchorOrgIds.size,
      total_suppliers: supplierOrgIds.size,
      total_volume: totalVolume,
      at_risk_count: atRiskCount,
    },
  })
}
