import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getOwnBoard, isBoardAdmin, loadBoardActor } from '@/lib/board/access'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/board/tasks — create (and optionally assign) a task. Admin-only
// — assigning work to teammates is a workflow-design action, same gate as
// creating stages/connections.
export async function POST(request: Request) {
  const loaded = await loadBoardActor(adminClient)
  if ('error' in loaded) return loaded.error
  const { actor } = loaded

  if (!isBoardAdmin(actor.role)) {
    return NextResponse.json({ error: 'Only org/bank admins can create and assign tasks' }, { status: 403 })
  }

  let body: {
    board_id?: string
    column_id?: string
    title?: string
    description?: string
    assignee_user_id?: string | null
    priority?: string
    due_date?: string | null
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.board_id || !body.column_id) {
    return NextResponse.json({ error: 'board_id and column_id are required' }, { status: 400 })
  }
  if (!body.title?.trim()) return NextResponse.json({ error: 'title is required' }, { status: 400 })
  if (body.title.trim().length > 160) return NextResponse.json({ error: 'title must be 160 characters or fewer' }, { status: 400 })
  if (body.priority && !['low', 'medium', 'high'].includes(body.priority)) {
    return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
  }

  const board = await getOwnBoard(adminClient, actor, body.board_id)
  if (!board) return NextResponse.json({ error: 'Board not found' }, { status: 404 })

  const { data: column } = await adminClient
    .from('board_columns')
    .select('id')
    .eq('id', body.column_id)
    .eq('board_id', board.id)
    .single()
  if (!column) return NextResponse.json({ error: 'Stage not found on this board' }, { status: 404 })

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

  const { count } = await adminClient
    .from('board_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('column_id', body.column_id)

  const { data: task, error } = await adminClient
    .from('board_tasks')
    .insert({
      board_id: board.id,
      column_id: body.column_id,
      title: body.title.trim(),
      description: body.description ?? null,
      assignee_user_id: body.assignee_user_id ?? null,
      priority: body.priority ?? 'medium',
      due_date: body.due_date ?? null,
      position: count ?? 0,
      created_by_user_id: actor.userId,
    })
    .select('*, assignee:assignee_user_id(id, full_name, email)')
    .single()

  if (error || !task) return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
  return NextResponse.json({ task }, { status: 201 })
}
