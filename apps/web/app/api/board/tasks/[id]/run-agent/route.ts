import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { callClaude, extractJson } from '@/lib/ai'
import { getOwnBoard, isBoardAdmin, loadBoardActor, logBoardTaskActivity } from '@/lib/board/access'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface AgentFindings {
  summary: string
  key_findings: string[]
  recommendations: string[]
  caveats: string[]
  suggested_next_step: string
}

// POST /api/board/tasks/[id]/run-agent — the agent drafts findings for a
// task it's assigned to. Never executes a real-world action and never
// changes the task itself (column, status, assignee) — it only writes an
// audit row a human then reads and acts on. Admin-only, same gate as every
// other workflow-design action on the board.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const loaded = await loadBoardActor(adminClient)
  if ('error' in loaded) return loaded.error
  const { actor } = loaded

  if (!isBoardAdmin(actor.role)) {
    return NextResponse.json({ error: 'Only org/bank admins can run an agent' }, { status: 403 })
  }

  const { data: task } = await adminClient
    .from('board_tasks')
    .select('*, column:column_id(name)')
    .eq('id', id)
    .single()
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const board = await getOwnBoard(adminClient, actor, task.board_id)
  if (!board) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  if (!task.assignee_agent_id) {
    return NextResponse.json({ error: 'This task is not assigned to an agent' }, { status: 400 })
  }

  const { data: agent } = await adminClient
    .from('board_agents')
    .select('*')
    .eq('id', task.assignee_agent_id)
    .single()
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  if (!agent.is_active) return NextResponse.json({ error: 'This agent is deactivated' }, { status: 400 })

  const model = 'claude-sonnet-4-6'
  const systemPrompt = [
    `You are "${agent.name}"${agent.role_label ? `, a ${agent.role_label} agent` : ''} inside a supply chain finance platform's team workflow board.`,
    agent.persona ? `Your instructions from the person who configured you: ${agent.persona}` : null,
    agent.guardrails ? `Guardrails you must never violate: ${agent.guardrails}` : null,
    agent.task_types.length > 0 ? `Task types you handle: ${agent.task_types.join(', ')}` : null,
    agent.expected_output ? `Expected output shape: ${agent.expected_output}` : null,
    'You cannot take any real-world action (no purchases, no messages sent, no commitments made) — you only produce a written analysis/draft for a human to review, revise, and act on themselves.',
    'Always respond with valid JSON only — no prose, no markdown fences.',
  ].filter(Boolean).join('\n\n')

  const userPrompt = `You have been assigned this task on the "${board.name}" board, in the "${task.column?.name ?? 'Unknown'}" stage:

Title: ${task.title}
${task.description ? `Description: ${task.description}` : '(no description provided)'}
${task.priority ? `Priority: ${task.priority}` : ''}
${task.due_date ? `Due date: ${task.due_date}` : ''}

Do the work described by this task as best you can from your own knowledge and reasoning — you do not have access to external tools or live data, so be explicit in "caveats" about anything you could not verify or would need a human/external source to confirm.

Respond with ONLY this JSON shape:
{
  "summary": "<2-3 sentence plain-language summary of what you did and found>",
  "key_findings": ["<specific finding 1>", "<specific finding 2>", "..."],
  "recommendations": ["<concrete, actionable recommendation 1>", "..."],
  "caveats": ["<limitation, assumption, or thing that needs human/external verification>", "..."],
  "suggested_next_step": "<one sentence: what should happen when this is handed off next>"
}`

  let output: AgentFindings | null = null
  let errorMessage: string | null = null

  try {
    const result = await callClaude({
      system: systemPrompt,
      model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: userPrompt }],
    })
    const parsed = extractJson<AgentFindings>(result.text)
    if (
      parsed &&
      typeof parsed.summary === 'string' &&
      Array.isArray(parsed.key_findings) &&
      Array.isArray(parsed.recommendations) &&
      Array.isArray(parsed.caveats) &&
      typeof parsed.suggested_next_step === 'string'
    ) {
      output = parsed
    } else {
      errorMessage = 'The agent response was not in the expected format'
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'Agent run failed'
  }

  const { data: run, error: insertError } = await adminClient
    .from('board_task_agent_runs')
    .insert({
      task_id: id,
      agent_id: agent.id,
      status: output ? 'completed' : 'failed',
      output,
      error: errorMessage,
      model,
      run_by_user_id: actor.userId,
    })
    .select()
    .single()

  if (insertError || !run) return NextResponse.json({ error: 'Failed to save agent run' }, { status: 500 })

  await logBoardTaskActivity(
    adminClient,
    id,
    actor.userId,
    output ? `${agent.name} completed a run — see Agent Findings below` : `${agent.name}'s run failed`
  )

  if (!output) return NextResponse.json({ error: errorMessage ?? 'Agent run failed', run }, { status: 502 })
  return NextResponse.json({ run })
}
