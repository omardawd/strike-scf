import { createClient as createAdmin } from '@supabase/supabase-js'
import type { DealFlowPreset, DealFlowPresetDetail } from '@strike-scf/types'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type Actor = { userId: string; orgId: string }

export interface SavePresetNodeInput {
  node_type: 'step' | 'cycle'
  title: string
  description?: string | null
  responsible_party: 'buyer' | 'supplier' | 'both'
  requires_document?: boolean
  position_x?: number | null
  position_y?: number | null
  repeat_count?: number | null
  repeat_interval_days?: number | null
}

export async function listPresets(orgId: string): Promise<DealFlowPreset[]> {
  const { data, error } = await adminClient.from('deal_flow_presets')
    .select('*').eq('org_id', orgId).order('name', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getPreset(presetId: string, orgId: string): Promise<DealFlowPresetDetail> {
  const { data: preset } = await adminClient.from('deal_flow_presets')
    .select('*').eq('id', presetId).eq('org_id', orgId).single()
  if (!preset) throw new Error('Template not found')

  const [{ data: nodes }, { data: edges }] = await Promise.all([
    adminClient.from('deal_flow_preset_nodes').select('*').eq('preset_id', presetId).order('position', { ascending: true }),
    adminClient.from('deal_flow_preset_edges').select('*').eq('preset_id', presetId),
  ])
  return { preset, nodes: nodes ?? [], edges: edges ?? [] }
}

/**
 * Saves the given nodes/edges (the same shape the canvas already builds for
 * PUT /api/deals/[id]/flow) as a new named, reusable template — the deal-
 * specific fields (status/proposed_by/due_at/anchor_date/completed_at) never
 * make sense on a template, so only the authoring fields are copied.
 */
export async function createPreset(input: {
  actor: Actor
  name: string
  description?: string | null
  nodes: SavePresetNodeInput[]
  edges?: { from: string; to: string; label?: string | null }[]
}): Promise<DealFlowPresetDetail> {
  const name = input.name.trim()
  if (!name || name.length > 80) throw new Error('Template name must be between 1 and 80 characters')
  if (!Array.isArray(input.nodes) || input.nodes.length === 0) throw new Error('At least one checkpoint is required')

  const { data: preset, error: presetErr } = await adminClient.from('deal_flow_presets')
    .insert({ org_id: input.actor.orgId, name, description: input.description?.trim() || null, created_by_user_id: input.actor.userId })
    .select().single()
  if (presetErr || !preset) throw new Error(presetErr?.code === '23505' ? 'You already have a template with this name' : (presetErr?.message ?? 'Unable to save template'))

  const { data: nodes, error: nodesErr } = await adminClient.from('deal_flow_preset_nodes')
    .insert(input.nodes.map((n, i) => ({
      preset_id: preset.id,
      node_type: n.node_type,
      title: n.title.trim(),
      description: n.description?.trim() || null,
      responsible_party: n.responsible_party,
      requires_document: n.requires_document ?? false,
      position_x: n.position_x ?? null,
      position_y: n.position_y ?? null,
      position: i,
      repeat_count: n.node_type === 'cycle' ? n.repeat_count : null,
      repeat_interval_days: n.node_type === 'cycle' ? n.repeat_interval_days : null,
    })))
    .select()
  if (nodesErr || !nodes) {
    await adminClient.from('deal_flow_presets').delete().eq('id', preset.id)
    throw new Error(nodesErr?.message ?? 'Unable to save template checkpoints')
  }

  let edges: DealFlowPresetDetail['edges'] = []
  if (input.edges?.length) {
    const byTitle = new Map(nodes.map(n => [n.title.toLowerCase(), n]))
    const edgeRows = input.edges
      .map(e => {
        const from = byTitle.get((e.from ?? '').trim().toLowerCase())
        const to = byTitle.get((e.to ?? '').trim().toLowerCase())
        if (!from || !to || from.id === to.id) return null
        return { preset_id: preset.id, from_node_id: from.id, to_node_id: to.id, label: e.label ?? null }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
    if (edgeRows.length) {
      const { data } = await adminClient.from('deal_flow_preset_edges').insert(edgeRows).select()
      edges = data ?? []
    }
  }

  return { preset, nodes, edges }
}

export async function deletePreset(presetId: string, orgId: string): Promise<void> {
  const { error, count } = await adminClient.from('deal_flow_presets')
    .delete({ count: 'exact' }).eq('id', presetId).eq('org_id', orgId)
  if (error) throw new Error(error.message)
  if (!count) throw new Error('Template not found')
}
