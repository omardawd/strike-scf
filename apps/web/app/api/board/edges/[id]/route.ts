import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getOwnBoard, isBoardAdmin, loadBoardActor } from '@/lib/board/access'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// DELETE /api/board/edges/[id] — remove a workflow arrow. Admin-only.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const loaded = await loadBoardActor(adminClient)
  if ('error' in loaded) return loaded.error
  const { actor } = loaded

  if (!isBoardAdmin(actor.role)) {
    return NextResponse.json({ error: 'Only org/bank admins can edit the workflow' }, { status: 403 })
  }

  const { data: edge } = await adminClient
    .from('board_column_edges')
    .select('id, board_id')
    .eq('id', id)
    .single()
  if (!edge) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

  const board = await getOwnBoard(adminClient, actor, edge.board_id)
  if (!board) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

  const { error } = await adminClient.from('board_column_edges').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  return NextResponse.json({ deleted: true })
}
