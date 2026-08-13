import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getOwnBoard, isBoardAdmin, loadBoardActor } from '@/lib/board/access'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function loadOwnColumn(actor: Parameters<typeof getOwnBoard>[1], columnId: string) {
  const { data: column } = await adminClient
    .from('board_columns')
    .select('*')
    .eq('id', columnId)
    .single()
  if (!column) return { column: null, board: null }
  const board = await getOwnBoard(adminClient, actor, column.board_id)
  return { column: board ? column : null, board }
}

// PATCH /api/board/columns/[id] — rename/reposition/recolor a stage, or drag
// it to a new (x, y) in the flow view. Admin-only.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const loaded = await loadBoardActor(adminClient)
  if ('error' in loaded) return loaded.error
  const { actor } = loaded

  if (!isBoardAdmin(actor.role)) {
    return NextResponse.json({ error: 'Only org/bank admins can edit stages' }, { status: 403 })
  }

  const { column } = await loadOwnColumn(actor, id)
  if (!column) return NextResponse.json({ error: 'Stage not found' }, { status: 404 })

  let body: {
    name?: string
    position?: number
    color?: string | null
    position_x?: number | null
    position_y?: number | null
    auto_assign_agent_id?: string | null
    requires_review?: boolean
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (body.name !== undefined) {
    if (!body.name.trim()) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    if (body.name.trim().length > 60) return NextResponse.json({ error: 'name must be 60 chars or fewer' }, { status: 400 })
  }

  if (body.auto_assign_agent_id) {
    const scopeColumn = actor.orgId ? 'org_id' : 'bank_id'
    const { data: agent } = await adminClient
      .from('board_agents')
      .select('id')
      .eq('id', body.auto_assign_agent_id)
      .eq(scopeColumn, actor.orgId ?? actor.bankId)
      .maybeSingle()
    if (!agent) return NextResponse.json({ error: 'Agent not found on this org/bank' }, { status: 400 })
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.name !== undefined) updates.name = body.name.trim()
  if (body.position !== undefined) updates.position = body.position
  if ('color' in body) updates.color = body.color
  if ('position_x' in body) updates.position_x = body.position_x
  if ('position_y' in body) updates.position_y = body.position_y
  if ('auto_assign_agent_id' in body) updates.auto_assign_agent_id = body.auto_assign_agent_id
  if (body.requires_review !== undefined) updates.requires_review = body.requires_review

  const { data: updated, error } = await adminClient
    .from('board_columns')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  return NextResponse.json({ column: updated })
}

// DELETE /api/board/columns/[id] — Admin-only. Blocked while tasks remain in
// the stage, to avoid silently orphaning or reassigning someone's work.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const loaded = await loadBoardActor(adminClient)
  if ('error' in loaded) return loaded.error
  const { actor } = loaded

  if (!isBoardAdmin(actor.role)) {
    return NextResponse.json({ error: 'Only org/bank admins can delete stages' }, { status: 403 })
  }

  const { column } = await loadOwnColumn(actor, id)
  if (!column) return NextResponse.json({ error: 'Stage not found' }, { status: 404 })

  const { count: taskCount } = await adminClient
    .from('board_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('column_id', id)

  if ((taskCount ?? 0) > 0) {
    return NextResponse.json({
      error: 'Cannot delete a stage with tasks in it. Move or delete its tasks first.',
    }, { status: 409 })
  }

  const { error } = await adminClient.from('board_columns').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  return NextResponse.json({ deleted: true })
}
