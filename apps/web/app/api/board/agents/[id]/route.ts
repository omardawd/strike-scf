import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { isBoardAdmin, loadBoardActor, type BoardActor } from '@/lib/board/access'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function getOwnAgent(id: string, actor: BoardActor) {
  const { data: agent } = await adminClient.from('board_agents').select('*').eq('id', id).single()
  if (!agent) return null
  if (actor.orgId && agent.org_id === actor.orgId) return agent
  if (actor.bankId && agent.bank_id === actor.bankId) return agent
  return null
}

// PATCH /api/board/agents/[id] — edit an agent's configuration. Admin-only.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const loaded = await loadBoardActor(adminClient)
  if ('error' in loaded) return loaded.error
  const { actor } = loaded

  if (!isBoardAdmin(actor.role)) {
    return NextResponse.json({ error: 'Only org/bank admins can edit agents' }, { status: 403 })
  }

  const agent = await getOwnAgent(id, actor)
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

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

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (body.name !== undefined) {
    if (!body.name.trim()) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    if (body.name.trim().length > 80) return NextResponse.json({ error: 'name must be 80 characters or fewer' }, { status: 400 })
    updates.name = body.name.trim()
  }
  if ('role_label' in body) updates.role_label = body.role_label?.trim() || null
  if ('persona' in body) updates.persona = body.persona?.trim() || null
  if (body.task_types !== undefined) updates.task_types = body.task_types.map(t => t.trim()).filter(Boolean).slice(0, 20)
  if ('expected_output' in body) updates.expected_output = body.expected_output?.trim() || null
  if ('guardrails' in body) updates.guardrails = body.guardrails?.trim() || null
  if (body.is_active !== undefined) updates.is_active = body.is_active

  const { data: updated, error } = await adminClient
    .from('board_agents')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  return NextResponse.json({ agent: updated })
}

// DELETE /api/board/agents/[id] — Admin-only, blocked while the agent is
// still assigned to any task (same "clear it first" pattern as deleting a
// stage with tasks in it).
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const loaded = await loadBoardActor(adminClient)
  if ('error' in loaded) return loaded.error
  const { actor } = loaded

  if (!isBoardAdmin(actor.role)) {
    return NextResponse.json({ error: 'Only org/bank admins can delete agents' }, { status: 403 })
  }

  const agent = await getOwnAgent(id, actor)
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const { count } = await adminClient
    .from('board_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('assignee_agent_id', id)
  if (count && count > 0) {
    return NextResponse.json({ error: 'Reassign or unassign this agent\'s tasks before deleting it' }, { status: 409 })
  }

  const { error } = await adminClient.from('board_agents').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  return NextResponse.json({ deleted: true })
}
