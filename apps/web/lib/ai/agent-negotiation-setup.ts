// Starts autonomous tick-loop follow-through for an offer that was submitted
// or countered directly through ad-hoc Strike AI chat (app/api/ai/chat/route.ts)
// or dispatch (app/api/ai/dispatch/route.ts), rather than through the Agent
// tab's scan -> GATE-1-approve flow. Without this,
// asking Strike AI in chat to "find a supplier and submit an offer" executes once
// and then sits there forever — nothing ever counters it back, because only
// agent_tasks rows created via the scan flow carry the `plan` the approve route
// uses to spin up an agent_negotiations row. This is the same setup that route
// does, called from a different trigger: a direct user request instead of the
// agent finding the opportunity on its own.
//
// Gated on org_agents.is_active — the existing global "I want autonomous
// behavior" switch. If the org has never activated their agent, a chat-driven
// offer stays one-shot, same as today. Once activated, every offer submitted or
// countered through chat gets the same autonomous negotiation + GATE 2 guarantee
// as scan-sourced proposals.
import { createClient as createAdmin } from '@supabase/supabase-js'
import { getAgentPreferences } from './agent-preferences'
import { HARD_MAX_ROUNDS, HARD_MAX_DEADLINE_DAYS } from './negotiation-constants'
import { postSystemMessage } from './agent-task-chat'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export interface FollowThroughResult {
  started: boolean
  reason?: 'no_offer_id' | 'agent_inactive' | 'already_tracked' | 'task_insert_failed' | 'negotiation_insert_failed'
}

export async function startAutonomousFollowThrough(params: {
  orgId: string
  toolName: 'submit_marketplace_offer' | 'counter_marketplace_offer'
  toolInput: Record<string, unknown>
  result: Record<string, unknown>
}): Promise<FollowThroughResult> {
  const { orgId, toolName, toolInput, result } = params

  const offerId = result.offer_id as string | undefined
  if (!offerId) return { started: false, reason: 'no_offer_id' }

  const { data: agent } = await adminClient
    .from('org_agents')
    .select('is_active')
    .eq('org_id', orgId)
    .maybeSingle()
  if (!agent?.is_active) return { started: false, reason: 'agent_inactive' }

  // Already being tracked — either a prior chat-driven call, or (for a counter
  // on an offer the counterparty's listing-defense already owns) someone else's
  // row. offer_id is UNIQUE on agent_negotiations either way.
  const { data: existing } = await adminClient
    .from('agent_negotiations')
    .select('id')
    .eq('offer_id', offerId)
    .maybeSingle()
  if (existing) return { started: false, reason: 'already_tracked' }

  const listingId = (result.listing_id as string | undefined) ?? (toolInput.listing_id as string | undefined) ?? null
  const prefs = await getAgentPreferences(orgId)
  const plan = {
    price_floor: null as number | null,
    price_ceiling: prefs.max_deal_value_auto,
    guardrails_configured: prefs.hasPriceGuardrails,
    max_rounds: HARD_MAX_ROUNDS,
    deadline_at: new Date(Date.now() + HARD_MAX_DEADLINE_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    preferences_snapshot: prefs,
  }

  const isCounter = toolName === 'counter_marketplace_offer'
  const { data: task, error: taskErr } = await adminClient
    .from('agent_tasks')
    .insert({
      org_id: orgId,
      type: isCounter ? 'negotiate' : 'submit_offer',
      title: `Autonomous follow-through on your ${isCounter ? 'counter-offer' : 'offer'}`.slice(0, 200),
      body: 'Started from a direct chat request rather than a scan proposal — since your agent is active, Strike AI will keep negotiating this within your standing risk preferences from here. You\'ll be asked to approve before anything is finalized.',
      proposed_action: { tool_name: toolName, tool_input: toolInput },
      plan,
      status: 'executing',
      result,
      approved_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (taskErr || !task) {
    console.error('[agent-negotiation-setup] agent_tasks insert failed:', taskErr)
    return { started: false, reason: 'task_insert_failed' }
  }

  const { error: negErr } = await adminClient.from('agent_negotiations').insert({
    agent_task_id: task.id,
    org_id: orgId,
    listing_id: listingId,
    offer_id: offerId,
    status: 'active',
  })

  if (negErr) {
    console.error('[agent-negotiation-setup] agent_negotiations insert failed:', negErr)
    await adminClient.from('agent_tasks').update({ status: 'failed' }).eq('id', task.id)
    return { started: false, reason: 'negotiation_insert_failed' }
  }

  await postSystemMessage(task.id, 'Started from a direct chat request — I\'ll keep negotiating this on your behalf and come back to you before finalizing anything.')

  return { started: true }
}
