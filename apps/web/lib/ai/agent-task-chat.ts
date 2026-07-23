// Per-task "plan chat" — lets a human discuss a specific proposed action with
// Strike AI before deciding, and lets Strike AI revise the action's terms live
// based on that conversation. This never executes anything itself; approval/
// rejection still happen via the existing approve/reject routes, which is what
// actually calls executeTool(). A "thread" spans every agent_tasks row in a
// negotiation lineage (the root GATE-1 task plus any escalation/finalization
// follow-ups), grouped by root_task_id — see supabase/migrations/...028.
import { createClient as createAdmin } from '@supabase/supabase-js'
import { executeTool } from './tools/execute'
import { TASK_CHAT_TOOLS } from './tools/definitions'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const MODEL = 'claude-sonnet-4-6'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

export async function resolveRootTaskId(taskId: string): Promise<string | null> {
  const { data } = await adminClient.from('agent_tasks').select('id, root_task_id').eq('id', taskId).single()
  if (!data) return null
  return (data.root_task_id as string | null) ?? (data.id as string)
}

/** Narrate something that happened (execution result, negotiation round, escalation, etc.) into the thread. */
export async function postSystemMessage(rootTaskId: string, content: string): Promise<void> {
  const { error } = await adminClient.from('agent_task_messages').insert({
    agent_task_id: rootTaskId,
    role: 'system',
    content,
  })
  if (error) console.error('[agent-task-chat] postSystemMessage failed:', error)
}

export async function getThread(rootTaskId: string): Promise<{
  rootTask: Row | null
  allTasks: Row[]
  /** The most recently created task row in this lineage — root, or a follow-up
   *  escalation/finalization task. This is the row whose status/proposed_action
   *  is "live" right now (what a revision applies to, what approve/reject/retry act on). */
  currentTask: Row | null
  messages: Row[]
}> {
  const [{ data: rootTaskRow }, { data: allTasksRows }, { data: messages }] = await Promise.all([
    adminClient.from('agent_tasks').select('*, agent_negotiations(id, status, current_round, last_tick_at, halt_requested, outcome_summary)').eq('id', rootTaskId).maybeSingle(),
    adminClient.from('agent_tasks').select('*, agent_negotiations(id, status, current_round, last_tick_at, halt_requested, outcome_summary)').or(`id.eq.${rootTaskId},root_task_id.eq.${rootTaskId}`).order('created_at', { ascending: true }),
    adminClient.from('agent_task_messages').select('*').eq('agent_task_id', rootTaskId).order('created_at', { ascending: true }),
  ])

  const flatten = (row: Row): Row => {
    const { agent_negotiations, ...rest } = row
    return { ...rest, negotiation: agent_negotiations?.[0] ?? null }
  }

  const rootTask = rootTaskRow ? flatten(rootTaskRow) : null
  const tasks = (allTasksRows ?? []).map(flatten)
  const currentTask = (tasks.length ? tasks[tasks.length - 1] : rootTask) ?? null

  return { rootTask, allTasks: tasks, currentTask, messages: messages ?? [] }
}

function buildSystemPrompt(rootTask: Row, currentTask: Row, plan: Row | null): string {
  const proposedAction = currentTask.proposed_action as { tool_name?: string; tool_input?: Row } | null
  const pending = currentTask.status === 'awaiting_approval'
  const negotiationLive = currentTask.negotiation?.status === 'active'

  return `You are Strike AI, discussing one specific proposed action with the human controller before they decide what to do with it.

Task: "${rootTask.title}"
${rootTask.body ?? ''}

${pending
    ? `Current proposed action (awaiting the human's approval): ${proposedAction?.tool_name} — ${JSON.stringify(proposedAction?.tool_input ?? {})}`
    : negotiationLive
      ? `This negotiation is currently executing autonomously (round ${currentTask.negotiation?.current_round ?? 0}).`
      : `This task is currently: ${currentTask.status}. There is nothing awaiting approval right now, so there is nothing to revise — just discuss.`}
${plan ? `Guardrails on this plan: price floor ${plan.price_floor ?? 'none'}, price ceiling ${plan.price_ceiling ?? 'none'}, max negotiation rounds ${plan.max_rounds ?? 'n/a'}.` : ''}

You never execute anything yourself in this chat — the human approves or rejects via buttons in the UI, and execution results are reported back into this same conversation as separate system messages. You can NEVER accept or finalize a deal from this chat, under any circumstances, even if asked to "auto-accept" or "close the deal on the next counter" — that always requires a separate, explicit human approval showing the exact final terms (GATE 2). If asked to do that, explain this plainly and offer the guardrail-revision alternative below instead.

${pending
    ? 'If the human asks you to change specific terms (amount, price, dates, incoterms, etc.), call revise_proposed_action with only the fields that should change. Otherwise just answer their question or discuss the plan conversationally.'
    : negotiationLive
      ? 'If the human asks you to change the standing price ceiling/floor/max rounds this negotiation is running under (e.g. "raise the ceiling to $420k", "be more aggressive"), call revise_negotiation_plan with only the fields that should change. This does NOT accept anything — it only changes what the autonomous loop is allowed to counter with on its next round. Otherwise just answer their question or discuss.'
      : 'Just answer their question or discuss — there is no pending action to revise.'}

You may use lookup_entities, get_active_deals, search_marketplace_listings, get_pricing_insights, or evaluate_listing_offers if you need more information before answering. Keep responses concise and written for a business reader (treasurer, CFO, ops controller) — no jargon, no raw IDs, no tool names.`
}

export async function postUserMessage(
  rootTaskId: string,
  orgId: string,
  content: string
): Promise<{ revised: boolean }> {
  const { rootTask, currentTask: latestTask, messages: priorMessages } = await getThread(rootTaskId)
  if (!rootTask || rootTask.org_id !== orgId) throw new Error('Task not found')

  await adminClient.from('agent_task_messages').insert({ agent_task_id: rootTaskId, role: 'user', content })

  const currentTask = latestTask ?? rootTask
  const plan = (currentTask.plan ?? null) as Row | null
  const system = buildSystemPrompt(rootTask, currentTask, plan)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anthropicMessages: any[] = [
    ...priorMessages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content },
  ]

  let revised = false
  let assistantText = ''

  for (let i = 0; i < 3; i++) {
    let res: Response
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'prompt-caching-2024-07-31',
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1024,
          system,
          messages: anthropicMessages,
          // TASK_CHAT_TOOLS is static — same cache_control-on-last-entry pattern
          // as the other call sites.
          tools: TASK_CHAT_TOOLS.map((t, i) =>
            i === TASK_CHAT_TOOLS.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t
          ),
          tool_choice: { type: 'auto', disable_parallel_tool_use: true },
        }),
      })
    } catch {
      assistantText = "Sorry, I couldn't reach the AI service just now — please try again."
      break
    }
    if (!res.ok) {
      assistantText = "Sorry, I couldn't process that — please try again."
      break
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json()
    const responseContent = data.content ?? []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolUse = responseContent.find((b: any) => b.type === 'tool_use')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textBlock = responseContent.find((b: any) => b.type === 'text')
    if (textBlock?.text) assistantText = textBlock.text as string

    if (!toolUse) break

    if (toolUse.name === 'revise_proposed_action') {
      const patch = (toolUse.input?.patch ?? {}) as Row
      const summary = (toolUse.input?.summary as string | undefined) ?? 'Updated the proposed terms.'
      const existingAction = (currentTask.proposed_action ?? {}) as { tool_name?: string; tool_input?: Row }
      const newToolInput = { ...(existingAction.tool_input ?? {}), ...patch }

      await adminClient.from('agent_tasks').update({
        proposed_action: { ...existingAction, tool_input: newToolInput },
        updated_at: new Date().toISOString(),
      }).eq('id', currentTask.id)

      revised = true
      assistantText = assistantText ? `${assistantText}\n\n_Revised: ${summary}_` : `Revised: ${summary}`
      break
    }

    if (toolUse.name === 'revise_negotiation_plan') {
      const input = (toolUse.input ?? {}) as { price_ceiling?: number; price_floor?: number; max_rounds?: number; summary?: string }
      const summary = input.summary ?? 'Updated the negotiation guardrails.'

      // agent_negotiations.agent_task_id always points at the root task (set
      // once at creation — see approve/route.ts and runListingDefenseTick),
      // not whichever follow-up task is currently "live" in this thread. The
      // tick loop reads plan from that root row on every tick, so that's the
      // row a guardrail revision has to land on to actually take effect.
      const existingPlan = (rootTask.plan ?? {}) as Row
      const newPlan = {
        ...existingPlan,
        ...(input.price_ceiling != null ? { price_ceiling: input.price_ceiling } : {}),
        ...(input.price_floor != null ? { price_floor: input.price_floor } : {}),
        ...(input.max_rounds != null ? { max_rounds: input.max_rounds } : {}),
        guardrails_configured: true,
      }

      await adminClient.from('agent_tasks').update({
        plan: newPlan,
        updated_at: new Date().toISOString(),
      }).eq('id', rootTask.id)

      revised = true
      assistantText = assistantText ? `${assistantText}\n\n_Updated: ${summary}_` : `Updated: ${summary}`
      break
    }

    const result = await executeTool(toolUse.name, toolUse.input)
    anthropicMessages.push({ role: 'assistant', content: responseContent })
    anthropicMessages.push({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) }],
    })
  }

  if (!assistantText) assistantText = "I don't have anything further to add right now."

  await adminClient.from('agent_task_messages').insert({ agent_task_id: rootTaskId, role: 'assistant', content: assistantText })

  return { revised }
}
