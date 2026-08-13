import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getOwnBoard, isBoardAdmin, loadBoardActor } from '@/lib/board/access'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/board/columns — create a workflow stage. Admin-only.
export async function POST(request: Request) {
  const loaded = await loadBoardActor(adminClient)
  if ('error' in loaded) return loaded.error
  const { actor } = loaded

  if (!isBoardAdmin(actor.role)) {
    return NextResponse.json({ error: 'Only org/bank admins can add stages' }, { status: 403 })
  }

  let body: { board_id?: string; name?: string; position?: number; color?: string; auto_assign_agent_id?: string | null; requires_review?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.board_id) return NextResponse.json({ error: 'board_id is required' }, { status: 400 })
  if (!body.name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (body.name.trim().length > 60) return NextResponse.json({ error: 'name must be 60 characters or fewer' }, { status: 400 })

  const board = await getOwnBoard(adminClient, actor, body.board_id)
  if (!board) return NextResponse.json({ error: 'Board not found' }, { status: 404 })

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

  let position = body.position
  if (position === undefined) {
    const { count } = await adminClient
      .from('board_columns')
      .select('id', { count: 'exact', head: true })
      .eq('board_id', board.id)
    position = count ?? 0
  }

  const { data: column, error } = await adminClient
    .from('board_columns')
    .insert({
      board_id: board.id,
      name: body.name.trim(),
      position,
      color: body.color ?? null,
      auto_assign_agent_id: body.auto_assign_agent_id ?? null,
      requires_review: body.requires_review ?? false,
    })
    .select()
    .single()

  if (error || !column) return NextResponse.json({ error: 'Failed to create stage' }, { status: 500 })
  return NextResponse.json({ column }, { status: 201 })
}
