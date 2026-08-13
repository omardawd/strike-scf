import { createClient as createAdmin } from '@supabase/supabase-js'
import type { DealFlowData, DealFlowNode, DealFlowRoadmapStage } from '@strike-scf/types'
import { sendEmail, dealWorkflowRespondedEmailHtml } from '@/lib/email'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type Actor = { userId: string; orgId: string }

// Mirrors DealRoadmap.tsx's ROADMAP_STEPS labels/keys, in order — the
// default flow seeded for every deal so a simple single-shipment deal needs
// no customization, and the title<->stage pairing every custom node's
// roadmap_stage is inferred against.
const DEFAULT_ROADMAP_STEPS: { title: string; stage: DealFlowRoadmapStage }[] = [
  { title: 'Agreed', stage: 'agreed' },
  { title: 'Contract', stage: 'contract_pending' },
  { title: 'In Business', stage: 'confirmed' },
  { title: 'Shipped', stage: 'shipped' },
  { title: 'Received', stage: 'goods_received' },
  { title: 'Accepted', stage: 'delivery_confirmed' },
  { title: 'Paid', stage: 'payment_confirmed' },
  { title: 'Completed', stage: 'completed' },
]

/**
 * Best-guess roadmap_stage for a node the caller (manual save or the AI
 * drafting tool) didn't explicitly classify — exact title match against the
 * fixed roadmap labels first, then keyword heuristics, defaulting to
 * 'confirmed' ("In Business") as the general "deal in progress" bucket for
 * anything unrecognizable. Never blocks a save — this is a convenience
 * classification, not a hard requirement.
 */
function inferRoadmapStage(title: string): DealFlowRoadmapStage {
  const exact = DEFAULT_ROADMAP_STEPS.find(s => s.title.toLowerCase() === title.toLowerCase())
  if (exact) return exact.stage
  const t = title.toLowerCase()
  if (t.includes('ship')) return 'shipped'
  if (t.includes('pay')) return 'payment_confirmed'
  if (t.includes('inspect') || t.includes('accept')) return 'delivery_confirmed'
  if (t.includes('receiv') || t.includes('deliver')) return 'goods_received'
  if (t.includes('contract')) return 'contract_pending'
  if (t.includes('agree')) return 'agreed'
  if (t.includes('complet') || t.includes('final')) return 'completed'
  return 'confirmed'
}

async function getDeal(dealId: string) {
  const { data } = await adminClient.from('deals')
    .select('id, buyer_org_id, supplier_org_id, status')
    .eq('id', dealId).single()
  if (!data) throw new Error('Deal not found')
  return data
}

function assertParty(deal: { buyer_org_id: string; supplier_org_id: string }, orgId: string) {
  if (![deal.buyer_org_id, deal.supplier_org_id].includes(orgId)) throw new Error('Forbidden')
}

function occurrenceDueAt(anchorDate: string, intervalDays: number, occurrenceIndex: number): string {
  const due = new Date(`${anchorDate}T00:00:00.000Z`)
  due.setUTCDate(due.getUTCDate() + (occurrenceIndex - 1) * intervalDays)
  return due.toISOString()
}

/**
 * (Re)materializes the pending occurrence rows for a cycle node from its
 * repeat_count/repeat_interval_days/anchor_date. Completed occurrences are
 * never touched — only the pending tail is deleted and reinserted, so
 * editing a cycle after some shipments have already been marked complete
 * can't silently erase that progress.
 */
async function materializeCycleOccurrences(
  cycleNodeId: string,
  repeatCount: number,
  repeatIntervalDays: number,
  anchorDate: string
) {
  const { data: existing } = await adminClient.from('deal_flow_cycle_occurrences')
    .select('id, occurrence_index, status').eq('cycle_node_id', cycleNodeId)

  const completedIndices = new Set((existing ?? []).filter(o => o.status === 'completed').map(o => o.occurrence_index))
  const pendingIds = (existing ?? []).filter(o => o.status === 'pending').map(o => o.id)
  if (pendingIds.length) {
    await adminClient.from('deal_flow_cycle_occurrences').delete().in('id', pendingIds)
  }

  const rows = []
  for (let i = 1; i <= repeatCount; i++) {
    if (completedIndices.has(i)) continue
    rows.push({
      cycle_node_id: cycleNodeId,
      occurrence_index: i,
      due_at: occurrenceDueAt(anchorDate, repeatIntervalDays, i),
      status: 'pending' as const,
    })
  }
  if (rows.length) {
    await adminClient.from('deal_flow_cycle_occurrences').insert(rows)
  }
}

async function getOrCreateTemplate(dealId: string, createdByUserId: string | null) {
  const { data: existing } = await adminClient.from('deal_flow_templates')
    .select('*').eq('deal_id', dealId).maybeSingle()
  if (existing) return existing

  const { data: created, error } = await adminClient.from('deal_flow_templates')
    .insert({ deal_id: dealId, source: 'default', created_by_user_id: createdByUserId })
    .select().single()
  if (error || !created) {
    // Race: another request created it concurrently — read it back.
    const { data: raced } = await adminClient.from('deal_flow_templates')
      .select('*').eq('deal_id', dealId).maybeSingle()
    if (raced) return raced
    throw new Error(error?.message ?? 'Unable to create deal flow')
  }
  return created
}

/**
 * Seeds the fixed 8-step default flow for a brand-new deal — called from
 * acceptOffer() at deal-creation time (Phase 3) and, defensively, the first
 * time GET /api/deals/[id]/flow is called for any deal that predates this
 * feature. Steps start 'accepted' (not 'proposed') — there's no counterpart
 * to propose/accept against for the system default; both parties are
 * already bound by the offer acceptance that created the deal.
 */
export async function seedDefaultDealFlow(dealId: string, buyerOrgId: string, createdByUserId: string | null = null) {
  const template = await getOrCreateTemplate(dealId, createdByUserId)

  const { count } = await adminClient.from('deal_flow_nodes')
    .select('id', { count: 'exact', head: true }).eq('flow_template_id', template.id)
  if (count && count > 0) return template

  await adminClient.from('deal_flow_nodes').insert(
    DEFAULT_ROADMAP_STEPS.map(({ title, stage }, position) => ({
      flow_template_id: template.id,
      node_type: 'step' as const,
      title,
      responsible_party: 'both' as const,
      position,
      status: 'accepted' as const,
      proposed_by_org_id: buyerOrgId,
      roadmap_stage: stage,
    }))
  )
  return template
}

export async function listDealFlow(dealId: string, actorOrgId: string): Promise<DealFlowData> {
  const deal = await getDeal(dealId)
  assertParty(deal, actorOrgId)

  const template = await getOrCreateTemplate(dealId, null)
  if (template.source === 'default') {
    await seedDefaultDealFlow(dealId, deal.buyer_org_id)
  }

  const [{ data: nodes }, { data: edges }] = await Promise.all([
    adminClient.from('deal_flow_nodes').select('*').eq('flow_template_id', template.id).order('position', { ascending: true }),
    adminClient.from('deal_flow_edges').select('*').eq('flow_template_id', template.id),
  ])

  const cycleNodeIds = (nodes ?? []).filter(n => n.node_type === 'cycle').map(n => n.id)
  let occurrences: DealFlowData['occurrences'] = []
  if (cycleNodeIds.length > 0) {
    const { data } = await adminClient.from('deal_flow_cycle_occurrences')
      .select('*').in('cycle_node_id', cycleNodeIds).order('occurrence_index', { ascending: true })
    occurrences = data ?? []
  }

  return { template, nodes: nodes ?? [], edges: edges ?? [], occurrences }
}

export interface SaveDealFlowNodeInput {
  node_type: 'step' | 'cycle'
  title: string
  description?: string | null
  responsible_party: 'buyer' | 'supplier' | 'both'
  requires_document?: boolean
  due_at?: string | null
  position_x?: number | null
  position_y?: number | null
  repeat_count?: number | null
  repeat_interval_days?: number | null
  anchor_date?: string | null
  roadmap_stage?: DealFlowRoadmapStage | null
}

/**
 * Full-replace save of a deal's flow (manual canvas "Save" and the AI
 * drafting tool both call this — one validated code path for both).
 * Existing nodes are matched to the new set by title (case-insensitive),
 * same reassignment strategy design_board_workflow uses for columns — a
 * matched node keeps its status/completed_at/proposed_by_*; an unmatched
 * title is treated as brand new (status 'proposed', awaiting the other
 * party's response, mirroring today's deal_workflow_steps behavior).
 */
export async function saveDealFlow(input: {
  dealId: string
  actor: Actor
  nodes: SaveDealFlowNodeInput[]
  edges?: { from: string; to: string; label?: string | null }[]
  source: 'manual' | 'ai_drafted'
}): Promise<DealFlowData> {
  const deal = await getDeal(input.dealId)
  if (deal.buyer_org_id !== input.actor.orgId) throw new Error('Only the buyer on this deal can edit the deal flow')
  if (!Array.isArray(input.nodes) || input.nodes.length === 0) throw new Error('At least one step is required')

  for (const node of input.nodes) {
    const title = (node.title ?? '').trim()
    if (!title || title.length > 120) throw new Error('Every node needs a title between 1 and 120 characters')
    if (!['buyer', 'supplier', 'both'].includes(node.responsible_party)) throw new Error('Invalid responsible party')
    if (node.node_type === 'cycle') {
      if (!node.repeat_count || node.repeat_count <= 0) throw new Error(`"${title}" needs a repeat count`)
      if (!node.repeat_interval_days || node.repeat_interval_days <= 0) throw new Error(`"${title}" needs a repeat interval`)
      if (!node.anchor_date) throw new Error(`"${title}" needs a start date`)
    }
  }

  const template = await getOrCreateTemplate(input.dealId, input.actor.userId)

  const { data: oldNodes } = await adminClient.from('deal_flow_nodes')
    .select('*').eq('flow_template_id', template.id)
  const oldByTitle = new Map<string, DealFlowNode>(
    (oldNodes ?? []).map((n: DealFlowNode) => [n.title.trim().toLowerCase(), n])
  )

  // Delete edges first (FK to nodes), then nodes not present in the new set
  // by title (this cascades their cycle occurrences too — but only for
  // nodes actually being dropped, not the ones we're about to re-upsert).
  await adminClient.from('deal_flow_edges').delete().eq('flow_template_id', template.id)

  const newTitles = new Set(input.nodes.map(n => n.title.trim().toLowerCase()))
  const droppedIds = (oldNodes ?? [])
    .filter((n: DealFlowNode) => !newTitles.has(n.title.trim().toLowerCase()))
    .map((n: DealFlowNode) => n.id)
  if (droppedIds.length) {
    await adminClient.from('deal_flow_nodes').delete().in('id', droppedIds)
  }

  const savedNodes: DealFlowNode[] = []
  for (let i = 0; i < input.nodes.length; i++) {
    const node = input.nodes[i]!
    const title = node.title.trim()
    const existing = oldByTitle.get(title.toLowerCase())

    const base = {
      node_type: node.node_type,
      title,
      description: node.description?.trim() || null,
      responsible_party: node.responsible_party,
      requires_document: node.requires_document ?? false,
      due_at: node.node_type === 'step' ? (node.due_at || null) : null,
      position_x: node.position_x ?? null,
      position_y: node.position_y ?? null,
      position: i,
      repeat_count: node.node_type === 'cycle' ? node.repeat_count : null,
      repeat_interval_days: node.node_type === 'cycle' ? node.repeat_interval_days : null,
      anchor_date: node.node_type === 'cycle' ? node.anchor_date : null,
      roadmap_stage: node.roadmap_stage ?? inferRoadmapStage(title),
    }

    if (existing) {
      const { data: updated, error } = await adminClient.from('deal_flow_nodes')
        .update(base).eq('id', existing.id).select().single()
      if (error || !updated) throw new Error(error?.message ?? 'Unable to update flow node')
      savedNodes.push(updated)
    } else {
      const { data: created, error } = await adminClient.from('deal_flow_nodes')
        .insert({
          ...base,
          flow_template_id: template.id,
          status: 'proposed',
          proposed_by_user_id: input.actor.userId,
          proposed_by_org_id: input.actor.orgId,
        }).select().single()
      if (error || !created) throw new Error(error?.message ?? 'Unable to create flow node')
      savedNodes.push(created)
    }
  }

  // Materialize/regenerate cycle occurrences for every cycle node, after
  // node ids are known.
  for (const node of savedNodes) {
    if (node.node_type === 'cycle' && node.repeat_count && node.repeat_interval_days && node.anchor_date) {
      await materializeCycleOccurrences(node.id, node.repeat_count, node.repeat_interval_days, node.anchor_date)
    }
  }

  if (input.edges?.length) {
    const byTitle = new Map(savedNodes.map(n => [n.title.toLowerCase(), n]))
    const edgeRows = input.edges
      .map(e => {
        const from = byTitle.get((e.from ?? '').trim().toLowerCase())
        const to = byTitle.get((e.to ?? '').trim().toLowerCase())
        if (!from || !to || from.id === to.id) return null
        return { flow_template_id: template.id, from_node_id: from.id, to_node_id: to.id, label: e.label ?? null }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
    if (edgeRows.length) {
      await adminClient.from('deal_flow_edges').insert(edgeRows)
    }
  }

  const priorSource = template.source
  const nextSource = priorSource === 'ai_drafted' || priorSource === 'ai_then_manual'
    ? (input.source === 'manual' ? 'ai_then_manual' : 'ai_drafted')
    : input.source
  await adminClient.from('deal_flow_templates')
    .update({ source: nextSource, locked_at: template.locked_at ?? new Date().toISOString() })
    .eq('id', template.id)

  return listDealFlow(input.dealId, input.actor.orgId)
}

export async function respondToFlowNode(input: {
  dealId: string
  nodeId: string
  actor: Actor
  response: 'accepted' | 'declined'
}) {
  const deal = await getDeal(input.dealId)
  if (deal.supplier_org_id !== input.actor.orgId) throw new Error('Only the supplier on this deal can respond')

  const { data: node } = await adminClient.from('deal_flow_nodes').select('*')
    .eq('id', input.nodeId).single()
  if (!node) throw new Error('Flow node not found')
  const { data: template } = await adminClient.from('deal_flow_templates')
    .select('deal_id').eq('id', node.flow_template_id).single()
  if (!template || template.deal_id !== input.dealId) throw new Error('Flow node not found')
  if (node.status !== 'proposed') throw new Error('This checkpoint is no longer awaiting a response')

  const now = new Date().toISOString()
  const { data, error } = await adminClient.from('deal_flow_nodes').update({
    status: input.response,
    responded_at: now,
    responded_by_user_id: input.actor.userId,
  }).eq('id', input.nodeId).eq('status', 'proposed').select().single()
  if (error || !data) throw new Error(error?.message ?? 'Unable to respond to checkpoint')

  await adminClient.from('deal_events').insert({
    deal_id: input.dealId,
    event_type: `workflow_step_${input.response}`,
    actor_user_id: input.actor.userId,
    actor_org_id: input.actor.orgId,
    description: `Custom deal flow checkpoint ${input.response}: ${node.title}`,
    metadata: { flow_node_id: node.id },
  })
  const { data: buyer } = await adminClient.from('organizations')
    .select('primary_contact_email').eq('id', deal.buyer_org_id).single()
  if (buyer?.primary_contact_email) void sendEmail({
    to: buyer.primary_contact_email,
    subject: `Deal flow checkpoint ${input.response} — Deal #${input.dealId.slice(0, 8).toUpperCase()}`,
    html: dealWorkflowRespondedEmailHtml({
      title: node.title,
      accepted: input.response === 'accepted',
      dealId: input.dealId,
      dealShortId: input.dealId.slice(0, 8).toUpperCase(),
    }),
  })
  return data as DealFlowNode
}

export async function completeFlowNode(input: { dealId: string; nodeId: string; actor: Actor }) {
  const deal = await getDeal(input.dealId)
  assertParty(deal, input.actor.orgId)
  const now = new Date().toISOString()
  const { data, error } = await adminClient.from('deal_flow_nodes').update({
    status: 'completed', completed_at: now,
  }).eq('id', input.nodeId).eq('status', 'accepted').select().single()
  if (error || !data) throw new Error(error?.message ?? 'Only accepted checkpoints can be completed')

  await adminClient.from('deal_events').insert({
    deal_id: input.dealId,
    event_type: 'workflow_step_completed',
    actor_user_id: input.actor.userId,
    actor_org_id: input.actor.orgId,
    description: `Custom deal flow checkpoint completed: ${data.title}`,
    metadata: { flow_node_id: data.id },
  })
  return data as DealFlowNode
}

export async function completeCycleOccurrence(input: { dealId: string; occurrenceId: string; actor: Actor }) {
  const deal = await getDeal(input.dealId)
  assertParty(deal, input.actor.orgId)

  const { data: occurrence } = await adminClient.from('deal_flow_cycle_occurrences')
    .select('*, node:cycle_node_id(id, title, flow_template_id)').eq('id', input.occurrenceId).single()
  if (!occurrence) throw new Error('Occurrence not found')
  const { data: template } = await adminClient.from('deal_flow_templates')
    .select('deal_id').eq('id', occurrence.node.flow_template_id).single()
  if (!template || template.deal_id !== input.dealId) throw new Error('Occurrence not found')

  const now = new Date().toISOString()
  const { data, error } = await adminClient.from('deal_flow_cycle_occurrences').update({
    status: 'completed', completed_at: now, completed_by_user_id: input.actor.userId,
  }).eq('id', input.occurrenceId).eq('status', 'pending').select().single()
  if (error || !data) throw new Error(error?.message ?? 'Only pending occurrences can be completed')

  await adminClient.from('deal_events').insert({
    deal_id: input.dealId,
    event_type: 'workflow_step_completed',
    actor_user_id: input.actor.userId,
    actor_org_id: input.actor.orgId,
    description: `Cycle occurrence #${data.occurrence_index} completed: ${occurrence.node.title}`,
    metadata: { cycle_node_id: occurrence.node.id, occurrence_id: data.id },
  })
  return data
}
