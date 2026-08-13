import { saveDealFlow, type SaveDealFlowNodeInput } from '@/lib/deals/flow'
import type { ToolActor } from './deal-workflow'

export interface DraftDealFlowInput {
  deal_id: string
  nodes: SaveDealFlowNodeInput[]
  edges?: { from: string; to: string; label?: string }[]
}

// Same "replace atomically" semantics as designBoardWorkflow (handlers/board.ts):
// the AI drafts a whole flow in one call, going through the exact same
// saveDealFlow() the manual canvas "Save" button uses — one validated code
// path for both AI and human authoring. Ownership (buyer-only) and node
// validation both live inside saveDealFlow() itself.
export async function draftDealFlow(input: DraftDealFlowInput, actor?: ToolActor) {
  if (!actor?.orgId) return { error: 'An authenticated organization user is required' }
  if (!input.deal_id) return { error: 'deal_id is required' }
  if (!Array.isArray(input.nodes) || input.nodes.length === 0) return { error: 'At least one checkpoint is required' }

  try {
    const flow = await saveDealFlow({
      dealId: input.deal_id,
      actor: { userId: actor.userId, orgId: actor.orgId },
      nodes: input.nodes,
      edges: input.edges,
      source: 'ai_drafted',
    })
    return {
      flow_template_id: flow.template.id,
      nodes: flow.nodes.map(n => ({ id: n.id, node_type: n.node_type, title: n.title, status: n.status })),
      deal_url: `/deals/${input.deal_id}`,
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to draft deal flow' }
  }
}
