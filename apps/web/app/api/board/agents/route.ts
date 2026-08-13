import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { fetchBoardAgents, isBoardAdmin, loadBoardActor } from '@/lib/board/access'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/board/agents — list the caller's org/bank configured agents.
export async function GET() {
  const loaded = await loadBoardActor(adminClient)
  if ('error' in loaded) return loaded.error
  const { actor } = loaded

  const agents = await fetchBoardAgents(adminClient, actor)
  return NextResponse.json({ agents })
}

// POST /api/board/agents — configure a new agent. Admin-only, same gate as
// designing the workflow or assigning tasks to teammates.
export async function POST(request: Request) {
  const loaded = await loadBoardActor(adminClient)
  if ('error' in loaded) return loaded.error
  const { actor } = loaded

  if (!isBoardAdmin(actor.role)) {
    return NextResponse.json({ error: 'Only org/bank admins can configure agents' }, { status: 403 })
  }
  if (!actor.orgId && !actor.bankId) {
    return NextResponse.json({ error: 'Agents are not available for this account' }, { status: 403 })
  }

  let body: {
    name?: string
    role_label?: string | null
    persona?: string | null
    task_types?: string[]
    expected_output?: string | null
    guardrails?: string | null
    is_active?: boolean
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (body.name.trim().length > 80) return NextResponse.json({ error: 'name must be 80 characters or fewer' }, { status: 400 })
  if (body.role_label && body.role_label.length > 60) return NextResponse.json({ error: 'role_label must be 60 characters or fewer' }, { status: 400 })
  if (body.persona && body.persona.length > 4000) return NextResponse.json({ error: 'persona must be 4000 characters or fewer' }, { status: 400 })
  if (body.expected_output && body.expected_output.length > 2000) return NextResponse.json({ error: 'expected_output must be 2000 characters or fewer' }, { status: 400 })
  if (body.guardrails && body.guardrails.length > 4000) return NextResponse.json({ error: 'guardrails must be 4000 characters or fewer' }, { status: 400 })

  const { data: agent, error } = await adminClient
    .from('board_agents')
    .insert({
      org_id: actor.orgId,
      bank_id: actor.orgId ? null : actor.bankId,
      name: body.name.trim(),
      role_label: body.role_label?.trim() || null,
      persona: body.persona?.trim() || null,
      task_types: (body.task_types ?? []).map(t => t.trim()).filter(Boolean).slice(0, 20),
      expected_output: body.expected_output?.trim() || null,
      guardrails: body.guardrails?.trim() || null,
      is_active: body.is_active ?? true,
      created_by_user_id: actor.userId,
    })
    .select()
    .single()

  if (error || !agent) return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 })
  return NextResponse.json({ agent }, { status: 201 })
}
