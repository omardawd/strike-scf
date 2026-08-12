import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getOwnBoard, isBoardAdmin, loadBoardActor, logBoardTaskActivity } from '@/lib/board/access'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/board/tasks/[id] — full detail: task + checklist + the combined
// comment/activity feed. Any board member can view (same as the board itself).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const loaded = await loadBoardActor(adminClient)
  if ('error' in loaded) return loaded.error
  const { actor } = loaded

  const { data: task } = await adminClient
    .from('board_tasks')
    .select('*, assignee:assignee_user_id(id, full_name, email)')
    .eq('id', id)
    .single()
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const board = await getOwnBoard(adminClient, actor, task.board_id)
  if (!board) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const [{ data: checklistItems }, { data: comments }] = await Promise.all([
    adminClient.from('board_task_checklist_items').select('*').eq('task_id', id).order('position', { ascending: true }),
    adminClient
      .from('board_task_comments')
      .select('*, author:author_user_id(id, full_name, email)')
      .eq('task_id', id)
      .order('created_at', { ascending: true }),
  ])

  return NextResponse.json({
    task,
    checklist_items: checklistItems ?? [],
    comments: comments ?? [],
    is_admin: isBoardAdmin(actor.role),
    current_user_id: actor.userId,
  })
}

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
    labels?: string[]
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Non-admins may only reposition their own card — every other field is a
  // workflow-design action reserved for org/bank admins.
  const nonMoveFieldsPresent = ['title', 'description', 'assignee_user_id', 'priority', 'due_date', 'labels']
    .some(key => key in body)
  if (!admin && nonMoveFieldsPresent) {
    return NextResponse.json({ error: 'Only org/bank admins can edit task details or reassign it' }, { status: 403 })
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  let movedToColumnName: string | null = null
  let assigneeName: string | null | undefined // undefined = not being changed; null = unassigned

  if (body.column_id !== undefined && body.column_id !== task.column_id) {
    const { data: column } = await adminClient
      .from('board_columns')
      .select('id, name')
      .eq('id', body.column_id)
      .eq('board_id', board.id)
      .single()
    if (!column) return NextResponse.json({ error: 'Stage not found on this board' }, { status: 404 })
    updates.column_id = body.column_id
    movedToColumnName = column.name
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
    if (body.labels !== undefined) updates.labels = body.labels.map(l => l.trim()).filter(Boolean).slice(0, 10)
    if ('assignee_user_id' in body && body.assignee_user_id !== task.assignee_user_id) {
      if (body.assignee_user_id) {
        const scopeColumn = actor.orgId ? 'org_id' : 'bank_id'
        const { data: assignee } = await adminClient
          .from('users')
          .select('id, full_name')
          .eq('id', body.assignee_user_id)
          .eq(scopeColumn, actor.orgId ?? actor.bankId)
          .maybeSingle()
        if (!assignee) return NextResponse.json({ error: 'Assignee must be a member of this org/bank' }, { status: 400 })
        assigneeName = assignee.full_name
      } else {
        assigneeName = null
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

  if (movedToColumnName) await logBoardTaskActivity(adminClient, id, actor.userId, `Moved to ${movedToColumnName}`)
  if (assigneeName !== undefined) {
    await logBoardTaskActivity(adminClient, id, actor.userId, assigneeName ? `Assigned to ${assigneeName}` : 'Unassigned')
  }

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
