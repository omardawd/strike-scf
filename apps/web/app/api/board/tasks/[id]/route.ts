import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getOwnBoard, isBoardAdmin, loadBoardActor } from '@/lib/board/access'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// PATCH /api/board/tasks/[id] — admins can edit anything; a non-admin may
// only move their own assigned card (column_id/position), matching the
// "everyone views + moves their own assigned tasks" rule.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const loaded = await loadBoardActor(adminClient)
  if ('error' in loaded) return loaded.error
  const { actor } = loaded

  const { data: task } = await adminClient
    .from('board_tasks')
    .select('*')
    .eq('id', id)
    .single()
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const board = await getOwnBoard(adminClient, actor, task.board_id)
  if (!board) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const admin = isBoardAdmin(actor.role)
  const isOwnTask = task.assignee_user_id === actor.userId

  if (!admin && !isOwnTask) {
    return NextResponse.json({ error: 'You can only move tasks assigned to you' }, { status: 403 })
  }

  let body: {
    column_id?: string
    position?: number
    title?: string
    description?: string | null
    assignee_user_id?: string | null
    priority?: string
    due_date?: string | null
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Non-admins may only reposition their own card — every other field is a
  // workflow-design action reserved for org/bank admins.
  const nonMoveFieldsPresent = ['title', 'description', 'assignee_user_id', 'priority', 'due_date']
    .some(key => key in body)
  if (!admin && nonMoveFieldsPresent) {
    return NextResponse.json({ error: 'Only org/bank admins can edit task details or reassign it' }, { status: 403 })
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (body.column_id !== undefined) {
    const { data: column } = await adminClient
      .from('board_columns')
      .select('id')
      .eq('id', body.column_id)
      .eq('board_id', board.id)
      .single()
    if (!column) return NextResponse.json({ error: 'Stage not found on this board' }, { status: 404 })
    updates.column_id = body.column_id
  }
  if (body.position !== undefined) updates.position = body.position

  if (admin) {
    if (body.title !== undefined) {
      if (!body.title.trim()) return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 })
      updates.title = body.title.trim()
    }
    if ('description' in body) updates.description = body.description ?? null
    if (body.priority !== undefined) {
      if (!['low', 'medium', 'high'].includes(body.priority)) {
        return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
      }
      updates.priority = body.priority
    }
    if ('due_date' in body) updates.due_date = body.due_date ?? null
    if ('assignee_user_id' in body) {
      if (body.assignee_user_id) {
        const scopeColumn = actor.orgId ? 'org_id' : 'bank_id'
        const { data: assignee } = await adminClient
          .from('users')
          .select('id')
          .eq('id', body.assignee_user_id)
          .eq(scopeColumn, actor.orgId ?? actor.bankId)
          .maybeSingle()
        if (!assignee) return NextResponse.json({ error: 'Assignee must be a member of this org/bank' }, { status: 400 })
      }
      updates.assignee_user_id = body.assignee_user_id ?? null
    }
  }

  const { data: updated, error } = await adminClient
    .from('board_tasks')
    .update(updates)
    .eq('id', id)
    .select('*, assignee:assignee_user_id(id, full_name, email)')
    .single()

  if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  return NextResponse.json({ task: updated })
}

// DELETE /api/board/tasks/[id] — Admin-only.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const loaded = await loadBoardActor(adminClient)
  if ('error' in loaded) return loaded.error
  const { actor } = loaded

  if (!isBoardAdmin(actor.role)) {
    return NextResponse.json({ error: 'Only org/bank admins can delete tasks' }, { status: 403 })
  }

  const { data: task } = await adminClient
    .from('board_tasks')
    .select('id, board_id')
    .eq('id', id)
    .single()
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const board = await getOwnBoard(adminClient, actor, task.board_id)
  if (!board) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const { error } = await adminClient.from('board_tasks').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  return NextResponse.json({ deleted: true })
}
