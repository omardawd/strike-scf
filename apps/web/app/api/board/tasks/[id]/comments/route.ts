import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getOwnBoard, loadBoardActor } from '@/lib/board/access'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/board/tasks/[id]/comments — add a comment. Open to any board
// member (viewing + discussing a task isn't a workflow-design action), same
// spirit as anyone being able to move their own assigned task.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const loaded = await loadBoardActor(adminClient)
  if ('error' in loaded) return loaded.error
  const { actor } = loaded

  const { data: task } = await adminClient.from('board_tasks').select('id, board_id').eq('id', id).single()
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  const board = await getOwnBoard(adminClient, actor, task.board_id)
  if (!board) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  let body: { body?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.body?.trim()) return NextResponse.json({ error: 'body is required' }, { status: 400 })
  if (body.body.trim().length > 2000) return NextResponse.json({ error: 'Comment must be 2000 characters or fewer' }, { status: 400 })

  const { data: comment, error } = await adminClient
    .from('board_task_comments')
    .insert({ task_id: id, kind: 'comment', author_user_id: actor.userId, body: body.body.trim() })
    .select('*, author:author_user_id(id, full_name, email)')
    .single()

  if (error || !comment) return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 })
  return NextResponse.json({ comment }, { status: 201 })
}
