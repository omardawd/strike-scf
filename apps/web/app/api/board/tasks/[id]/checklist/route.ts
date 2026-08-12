import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getOwnBoard, isBoardAdmin, loadBoardActor, logBoardTaskActivity } from '@/lib/board/access'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/board/tasks/[id]/checklist — add a checklist item. Admin-only,
// same gate as adding a task itself; toggling an item off is a lighter
// action left to the assignee too (see [itemId]/route.ts PATCH).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const loaded = await loadBoardActor(adminClient)
  if ('error' in loaded) return loaded.error
  const { actor } = loaded

  if (!isBoardAdmin(actor.role)) {
    return NextResponse.json({ error: 'Only org/bank admins can add checklist items' }, { status: 403 })
  }

  const { data: task } = await adminClient.from('board_tasks').select('id, board_id').eq('id', id).single()
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  const board = await getOwnBoard(adminClient, actor, task.board_id)
  if (!board) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  let body: { text?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.text?.trim()) return NextResponse.json({ error: 'text is required' }, { status: 400 })
  if (body.text.trim().length > 200) return NextResponse.json({ error: 'text must be 200 characters or fewer' }, { status: 400 })

  const { count } = await adminClient
    .from('board_task_checklist_items')
    .select('id', { count: 'exact', head: true })
    .eq('task_id', id)

  const { data: item, error } = await adminClient
    .from('board_task_checklist_items')
    .insert({ task_id: id, text: body.text.trim(), position: count ?? 0, created_by_user_id: actor.userId })
    .select()
    .single()

  if (error || !item) return NextResponse.json({ error: 'Failed to add checklist item' }, { status: 500 })

  await logBoardTaskActivity(adminClient, id, actor.userId, `Added checklist item "${item.text}"`)
  return NextResponse.json({ item }, { status: 201 })
}
