import { listWorkflowSteps, proposeWorkflowStep } from '@/lib/deals/workflow'

export interface ProposeDealWorkflowStepInput {
  deal_id: string
  title: string
  description?: string
  responsible_party: 'buyer' | 'supplier' | 'both'
  requires_document?: boolean
  due_at?: string
}

export type ToolActor = { userId: string; orgId: string | null; bankId: string | null }

export async function proposeDealWorkflowStep(input: ProposeDealWorkflowStepInput, actor?: ToolActor) {
  if (!actor?.orgId) return { error: 'An authenticated organization user is required' }
  try {
    const step = await proposeWorkflowStep({
      dealId: input.deal_id,
      actor: { userId: actor.userId, orgId: actor.orgId },
      title: input.title,
      description: input.description,
      responsibleParty: input.responsible_party,
      requiresDocument: input.requires_document,
      dueAt: input.due_at,
    })
    return { workflow_step: step, deal_url: `/deals/${input.deal_id}` }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to propose workflow step' }
  }
}

export async function getDealWorkflow(input: { deal_id: string }, actor?: ToolActor) {
  if (!actor?.orgId) return { error: 'An authenticated organization user is required' }
  try {
    return { deal_id: input.deal_id, steps: await listWorkflowSteps(input.deal_id, actor.orgId) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to read deal workflow' }
  }
}
