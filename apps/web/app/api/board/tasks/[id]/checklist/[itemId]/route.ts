import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getOwnBoard, isBoardAdmin, loadBoardActor, logBoardTaskActivity } from '@/lib/board/access'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function loadOwnItem(actor: Parameters<typeof getOwnBoard>[1], taskId: string, itemId: string) {
  const { data: task } = await adminClient.from('board_tasks').select('id, board_id, assignee_user_id').eq('id', taskId).single()
  if (!task) return { task: null, item: null }
  const board = await getOwnBoard(adminClient, actor, task.board_id)
  if (!board) return { task: null, item: null }
  const { data: item } = await adminClient
    .from('board_task_checklist_items')
    .select('*')
    .eq('id', itemId)
    .eq('task_id', taskId)
    .single()
  return { task, item }
}

// PATCH /api/board/tasks/[id]/checklist/[itemId] — toggling is_done is
// allowed for an admin OR the task's assignee (same "lighter action" rule as
// moving the task itself); renaming the item text is admin-only.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params
  const loaded = await loadBoardActor(adminClient)
  if ('error' in loaded) return loaded.error
  const { actor } = loaded

  const { task, item } = await loadOwnItem(actor, id, itemId)
  if (!task || !item) return NextResponse.json({ error: 'Checklist item not found' }, { status: 404 })

  const admin = isBoardAdmin(actor.role)
  const isOwnTask = task.assignee_user_id === actor.userId
  if (!admin && !isOwnTask) {
    return NextResponse.json({ error: 'Only the task assignee or an admin can update this checklist item' }, { status: 403 })
  }

  let body: { is_done?: boolean; text?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if ('text' in body && !admin) {
    return NextResponse.json({ error: 'Only org/bank admins can rename checklist items' }, { status: 403 })
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.is_done !== undefined) updates.is_done = body.is_done
  if (body.text !== undefined) {
    if (!body.text.trim()) return NextResponse.json({ error: 'text cannot be empty' }, { status: 400 })
    updates.text = body.text.trim()
  }

  const { data: updated, error } = await adminClient
    .from('board_task_checklist_items')
    .update(updates)
    .eq('id', itemId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

  if (body.is_done !== undefined) {
    await logBoardTaskActivity(adminClient, id, actor.userId, `${body.is_done ? 'Checked off' : 'Reopened'} "${item.text}"`)
  }

  return NextResponse.json({ item: updated })
}

// DELETE /api/board/tasks/[id]/checklist/[itemId] — Admin-only.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params
  const loaded = await loadBoardActor(adminClient)
  if ('error' in loaded) return loaded.error
  const { actor } = loaded

  if (!isBoardAdmin(actor.role)) {
    return NextResponse.json({ error: 'Only org/bank admins can delete checklist items' }, { status: 403 })
  }

  const { task, item } = await loadOwnItem(actor, id, itemId)
  if (!task || !item) return NextResponse.json({ error: 'Checklist item not found' }, { status: 404 })

  const { error } = await adminClient.from('board_task_checklist_items').delete().eq('id', itemId)
  if (error) return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  return NextResponse.json({ deleted: true })
}
