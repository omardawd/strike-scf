import { createClient as createAdmin } from '@supabase/supabase-js'
import { executeTool, type ToolName } from './tools/execute'
import { NEGOTIATION_CAPABLE_TOOLS } from './negotiation-constants'
import { postSystemMessage } from './agent-task-chat'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface TaskPlan {
  negotiation_id?: string
  [key: string]: unknown
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TaskRow = any

// Extracted from app/api/agents/tasks/[id]/approve/route.ts so the real GATE-1/GATE-2 approval
// logic has exactly one implementation — shared by that route and the demo-only cross-org
// approval route (app/api/demo/approve-task/route.ts). Executes task.proposed_action, updates
// agent_tasks/agent_negotiations state, and posts the system narration message. Callers are
// responsible for auth/ownership checks before calling this — it trusts `task` and
// `approvedByUserId` as already authorized to act on this specific task.
export async function executeApproval(
  task: TaskRow,
  approvedByUserId: string
): Promise<{ success: true; result: Record<string, unknown> }> {
  const id = task.id as string
  const orgId = task.org_id as string

  // Mark as approved
  await adminClient.from('agent_tasks').update({
    status: 'approved',
    approved_by_user_id: approvedByUserId,
    approved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  const rootTaskId = (task.root_task_id as string | null) ?? id
  const plan = (task.plan ?? null) as TaskPlan | null
  const negotiationId = plan?.negotiation_id

  // A task starts a new negotiation when it carries guardrails (plan is set)
  // but has no negotiation_id yet — that id only exists once the negotiation
  // row itself has been created, which happens below on this same approval.
  const startsNewNegotiation = Boolean(
    plan && !negotiationId &&
    NEGOTIATION_CAPABLE_TOOLS.includes(task.proposed_action?.tool_name)
  )

  // Execute the proposed action if one exists
  let result: Record<string, unknown> = {}
  if (task.proposed_action?.tool_name) {
    const toolName  = task.proposed_action.tool_name as ToolName
    const toolInput = (task.proposed_action.tool_input ?? {}) as Record<string, unknown>

    try {
      result = await executeTool(toolName, { ...toolInput, org_id: toolInput.org_id ?? orgId })
      const succeeded = !('error' in result)

      // Log to agent_actions. action_type is a closed enum — only insert with
      // values that actually exist there (see migration 00000000000024); this
      // insert silently failed on every real tool execution before that fix,
      // and agent_actions has no user_id column (that's what approved_by_user_id is for).
      const { error: logError } = await adminClient.from('agent_actions').insert({
        org_id: orgId,
        action_type: toolName,
        entity_type: 'agent_task',
        entity_id: id,
        input_summary: JSON.stringify(toolInput).slice(0, 500),
        output_summary: JSON.stringify(result).slice(0, 500),
        outcome: succeeded ? 'success' : 'error',
        requires_approval: true,
        human_approved: true,
        approved_by_user_id: approvedByUserId,
        approved_at: new Date().toISOString(),
        model: 'agent',
        reasoning: `Approved by ${approvedByUserId} via agent task ${id}`,
      })
      if (logError) console.error('[agent-approve] agent_actions log failed:', logError)

      if (succeeded && startsNewNegotiation) {
        // GATE 1 just passed: the listing/offer is posted, and negotiation now
        // proceeds autonomously (bounded by `plan`) until GATE 2. Never mark
        // this 'completed' — 'executing' is what the tick loop polls for.
        const { error: negErr } = await adminClient.from('agent_negotiations').insert({
          agent_task_id: id,
          org_id: orgId,
          listing_id: (result.listing_id as string | undefined) ?? null,
          offer_id: (result.offer_id as string | undefined) ?? null,
          status: 'active',
        })
        if (negErr) console.error('[agent-approve] agent_negotiations insert failed:', negErr)

        await adminClient.from('agent_tasks').update({
          status: negErr ? 'failed' : 'executing',
          result,
          updated_at: new Date().toISOString(),
        }).eq('id', id)

        await postSystemMessage(rootTaskId, negErr
          ? 'Approved and executed, but I hit an internal error starting the tracked negotiation. The action went through — check with support if updates stop appearing here.'
          : 'Approved. This is posted and the negotiation has started — I\'ll keep you updated here as it progresses, and come back to you before finalizing anything.')
      } else {
        if (succeeded && negotiationId) {
          // Follow-up task on an existing negotiation: either GATE 2 (finalize —
          // accept_marketplace_offer already ran above) or an escalation the
          // human resolved by approving the tick loop's proposed action.
          if (task.type === 'negotiation_ready_to_finalize') {
            await adminClient.from('agent_negotiations').update({
              status: 'completed_accepted',
              deal_id: (result.deal_id as string | undefined) ?? null,
              outcome_summary: 'Human approved finalization; deal created.',
              updated_at: new Date().toISOString(),
            }).eq('id', negotiationId)
            await postSystemMessage(rootTaskId, 'Approved. The deal has been finalized and created.')
          } else if (task.type === 'negotiation_escalation') {
            await adminClient.from('agent_negotiations').update({
              status: 'active',
              halt_requested: false,
              updated_at: new Date().toISOString(),
            }).eq('id', negotiationId)
            await postSystemMessage(rootTaskId, 'Approved. Executing this and resuming autonomous negotiation — I\'ll keep you posted here.')
          }
        } else if (!succeeded && negotiationId) {
          await adminClient.from('agent_negotiations').update({
            status: 'failed',
            outcome_summary: `Approved action failed to execute: ${JSON.stringify(result).slice(0, 300)}`,
            updated_at: new Date().toISOString(),
          }).eq('id', negotiationId)
          await postSystemMessage(rootTaskId, `Approved, but execution failed: ${String(result.error ?? 'unknown error')}. The negotiation has stopped.`)
        } else if (succeeded) {
          await postSystemMessage(rootTaskId, 'Approved and executed successfully.')
        } else {
          await postSystemMessage(rootTaskId, `Approved, but execution failed: ${String(result.error ?? 'unknown error')}.`)
        }

        await adminClient.from('agent_tasks').update({
          status: succeeded ? 'completed' : 'failed',
          result,
          updated_at: new Date().toISOString(),
        }).eq('id', id)
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Tool execution failed'
      result = { error: errMsg }
      if (negotiationId) {
        await adminClient.from('agent_negotiations').update({
          status: 'failed',
          outcome_summary: `Approved action threw: ${errMsg}`,
          updated_at: new Date().toISOString(),
        }).eq('id', negotiationId)
      }
      await adminClient.from('agent_tasks').update({
        status: 'failed',
        result,
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      await postSystemMessage(rootTaskId, `Approved, but something went wrong executing this: ${errMsg}.`)
    }
  } else {
    // No action to execute — mark as completed (informational advisory)
    await adminClient.from('agent_tasks').update({
      status: 'completed',
      result: { acknowledged: true },
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    await postSystemMessage(rootTaskId, 'Acknowledged — no action was needed for this one.')
  }

  return { success: true, result }
}
