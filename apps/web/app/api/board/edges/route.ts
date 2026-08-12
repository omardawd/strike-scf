import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getOwnBoard, isBoardAdmin, loadBoardActor } from '@/lib/board/access'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/board/edges — add an arrow between two stages (the workflow's
// shape in the flow view). Admin-only.
export async function POST(request: Request) {
  const loaded = await loadBoardActor(adminClient)
  if ('error' in loaded) return loaded.error
  const { actor } = loaded

  if (!isBoardAdmin(actor.role)) {
    return NextResponse.json({ error: 'Only org/bank admins can edit the workflow' }, { status: 403 })
  }

  let body: { board_id?: string; from_column_id?: string; to_column_id?: string; label?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.board_id || !body.from_column_id || !body.to_column_id) {
    return NextResponse.json({ error: 'board_id, from_column_id and to_column_id are required' }, { status: 400 })
  }
  if (body.from_column_id === body.to_column_id) {
    return NextResponse.json({ error: 'A stage cannot connect to itself' }, { status: 400 })
  }

  const board = await getOwnBoard(adminClient, actor, body.board_id)
  if (!board) return NextResponse.json({ error: 'Board not found' }, { status: 404 })

  const { data: columns } = await adminClient
    .from('board_columns')
    .select('id')
    .eq('board_id', board.id)
    .in('id', [body.from_column_id, body.to_column_id])

  if ((columns?.length ?? 0) !== 2) {
    return NextResponse.json({ error: 'Both stages must belong to this board' }, { status: 400 })
  }

  const { data: edge, error } = await adminClient
    .from('board_column_edges')
    .insert({
      board_id: board.id,
      from_column_id: body.from_column_id,
      to_column_id: body.to_column_id,
      label: body.label ?? null,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'This connection already exists' }, { status: 409 })
    return NextResponse.json({ error: 'Failed to create connection' }, { status: 500 })
  }
  return NextResponse.json({ edge }, { status: 201 })
}
