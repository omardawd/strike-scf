import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getOrCreateBoard, fetchBoardData, isBoardAdmin, loadBoardActor } from '@/lib/board/access'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/board — get-or-create the caller's org/bank board.
export async function GET() {
  const loaded = await loadBoardActor(adminClient)
  if ('error' in loaded) return loaded.error
  const { actor } = loaded

  const board = await getOrCreateBoard(adminClient, actor)
  if (!board) return NextResponse.json({ error: 'Board is not available for this account' }, { status: 403 })

  const { columns, edges, tasks } = await fetchBoardData(adminClient, board.id)
  return NextResponse.json({
    board,
    columns,
    edges,
    tasks,
    is_admin: isBoardAdmin(actor.role),
  })
}

// PATCH /api/board — rename the board. Admin-only.
export async function PATCH(request: Request) {
  const loaded = await loadBoardActor(adminClient)
  if ('error' in loaded) return loaded.error
  const { actor } = loaded

  if (!isBoardAdmin(actor.role)) {
    return NextResponse.json({ error: 'Only org/bank admins can rename the board' }, { status: 403 })
  }

  const board = await getOrCreateBoard(adminClient, actor)
  if (!board) return NextResponse.json({ error: 'Board is not available for this account' }, { status: 403 })

  let body: { name?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (body.name.trim().length > 80) return NextResponse.json({ error: 'name must be 80 characters or fewer' }, { status: 400 })

  const { data: updated, error } = await adminClient
    .from('boards')
    .update({ name: body.name.trim(), updated_at: new Date().toISOString() })
    .eq('id', board.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  return NextResponse.json({ board: updated })
}
