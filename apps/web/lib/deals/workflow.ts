import { createClient as createAdmin } from '@supabase/supabase-js'
import type { DealWorkflowStep } from '@strike-scf/types'
import { sendEmail, dealWorkflowProposedEmailHtml, dealWorkflowRespondedEmailHtml } from '@/lib/email'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type Actor = { userId: string; orgId: string }

async function getDeal(dealId: string) {
  const { data } = await adminClient.from('deals')
    .select('id, buyer_org_id, supplier_org_id, status')
    .eq('id', dealId).single()
  if (!data) throw new Error('Deal not found')
  return data
}

export async function listWorkflowSteps(dealId: string, actorOrgId: string): Promise<DealWorkflowStep[]> {
  const deal = await getDeal(dealId)
  if (![deal.buyer_org_id, deal.supplier_org_id].includes(actorOrgId)) throw new Error('Forbidden')
  const { data, error } = await adminClient.from('deal_workflow_steps').select('*')
    .eq('deal_id', dealId).order('position', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as DealWorkflowStep[]
}

export async function proposeWorkflowStep(input: {
  dealId: string
  actor: Actor
  title: string
  description?: string | null
  responsibleParty: 'buyer' | 'supplier' | 'both'
  requiresDocument?: boolean
  dueAt?: string | null
}) {
  const deal = await getDeal(input.dealId)
  if (deal.buyer_org_id !== input.actor.orgId) throw new Error('Only the buyer on this deal can propose workflow steps')
  const title = input.title.trim()
  if (!title || title.length > 120) throw new Error('Title must be between 1 and 120 characters')
  if (!['buyer', 'supplier', 'both'].includes(input.responsibleParty)) throw new Error('Invalid responsible party')
  if (input.dueAt && Number.isNaN(Date.parse(input.dueAt))) throw new Error('Invalid due date')

  const { data: last } = await adminClient.from('deal_workflow_steps').select('position')
    .eq('deal_id', input.dealId).order('position', { ascending: false }).limit(1).maybeSingle()
  const { data, error } = await adminClient.from('deal_workflow_steps').insert({
    deal_id: input.dealId,
    position: (last?.position ?? -1) + 1,
    title,
    description: input.description?.trim() || null,
    responsible_party: input.responsibleParty,
    requires_document: input.requiresDocument ?? false,
    due_at: input.dueAt || null,
    proposed_by_user_id: input.actor.userId,
    proposed_by_org_id: input.actor.orgId,
  }).select().single()
  if (error || !data) throw new Error(error?.message ?? 'Unable to create workflow step')

  await adminClient.from('deal_events').insert({
    deal_id: input.dealId,
    event_type: 'workflow_step_proposed',
    actor_user_id: input.actor.userId,
    actor_org_id: input.actor.orgId,
    description: `Custom workflow step proposed: ${title}`,
    metadata: { workflow_step_id: data.id, responsible_party: input.responsibleParty },
  })
  const [{ data: supplier }, { data: buyer }] = await Promise.all([
    adminClient.from('organizations').select('primary_contact_email').eq('id', deal.supplier_org_id).single(),
    adminClient.from('organizations').select('legal_name').eq('id', deal.buyer_org_id).single(),
  ])
  if (supplier?.primary_contact_email) void sendEmail({
    to: supplier.primary_contact_email,
    subject: `Workflow step proposed — Deal #${input.dealId.slice(0, 8).toUpperCase()}`,
    html: dealWorkflowProposedEmailHtml({
      buyerName: buyer?.legal_name ?? 'Buyer',
      title,
      responsibleParty: input.responsibleParty,
      dealId: input.dealId,
      dealShortId: input.dealId.slice(0, 8).toUpperCase(),
    }),
  })
  return data as DealWorkflowStep
}

export async function respondToWorkflowStep(input: {
  dealId: string
  stepId: string
  actor: Actor
  response: 'accepted' | 'declined'
}) {
  const deal = await getDeal(input.dealId)
  if (deal.supplier_org_id !== input.actor.orgId) throw new Error('Only the supplier on this deal can respond')
  const { data: step } = await adminClient.from('deal_workflow_steps').select('*')
    .eq('id', input.stepId).eq('deal_id', input.dealId).single()
  if (!step) throw new Error('Workflow step not found')
  if (step.status !== 'proposed') throw new Error('Workflow step is no longer awaiting a response')
  if (step.proposed_by_user_id === input.actor.userId) throw new Error('You cannot respond to your own proposal')

  const now = new Date().toISOString()
  const { data, error } = await adminClient.from('deal_workflow_steps').update({
    status: input.response,
    responded_at: now,
    responded_by_user_id: input.actor.userId,
  }).eq('id', input.stepId).eq('status', 'proposed').select().single()
  if (error || !data) throw new Error(error?.message ?? 'Unable to respond to workflow step')
  await adminClient.from('deal_events').insert({
    deal_id: input.dealId,
    event_type: `workflow_step_${input.response}`,
    actor_user_id: input.actor.userId,
    actor_org_id: input.actor.orgId,
    description: `Custom workflow step ${input.response}: ${step.title}`,
    metadata: { workflow_step_id: step.id },
  })
  const { data: buyer } = await adminClient.from('organizations')
    .select('primary_contact_email').eq('id', deal.buyer_org_id).single()
  if (buyer?.primary_contact_email) void sendEmail({
    to: buyer.primary_contact_email,
    subject: `Workflow step ${input.response} — Deal #${input.dealId.slice(0, 8).toUpperCase()}`,
    html: dealWorkflowRespondedEmailHtml({
      title: step.title,
      accepted: input.response === 'accepted',
      dealId: input.dealId,
      dealShortId: input.dealId.slice(0, 8).toUpperCase(),
    }),
  })
  return data as DealWorkflowStep
}

export async function completeWorkflowStep(input: { dealId: string; stepId: string; actor: Actor }) {
  const deal = await getDeal(input.dealId)
  if (![deal.buyer_org_id, deal.supplier_org_id].includes(input.actor.orgId)) throw new Error('Forbidden')
  const now = new Date().toISOString()
  const { data, error } = await adminClient.from('deal_workflow_steps').update({
    status: 'completed', completed_at: now,
  }).eq('id', input.stepId).eq('deal_id', input.dealId).eq('status', 'accepted').select().single()
  if (error || !data) throw new Error(error?.message ?? 'Only accepted workflow steps can be completed')
  await adminClient.from('deal_events').insert({
    deal_id: input.dealId,
    event_type: 'workflow_step_completed',
    actor_user_id: input.actor.userId,
    actor_org_id: input.actor.orgId,
    description: `Custom workflow step completed: ${data.title}`,
    metadata: { workflow_step_id: data.id },
  })
  return data as DealWorkflowStep
}
