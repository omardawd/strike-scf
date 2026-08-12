import { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export interface BoardActor {
  userId: string
  role: string
  orgId: string | null
  bankId: string | null
}

export interface BoardRow {
  id: string
  org_id: string | null
  bank_id: string | null
  name: string
  created_by_user_id: string | null
  created_at: string
  updated_at: string
}

const DEFAULT_COLUMNS = ['To Do', 'In Progress', 'Done']

/** Only org_admin/bank_admin design the workflow (columns/edges/board name) and assign tasks to others. */
export function isBoardAdmin(role: string): boolean {
  return role === 'org_admin' || role === 'bank_admin'
}

/**
 * Resolves the single board for the actor's org/bank, creating it (with 3
 * default columns + a linear edge chain between them) on first visit.
 * strike_admin has neither org_id nor bank_id — Board is org/bank-scoped
 * only, so this returns null for them.
 */
export async function getOrCreateBoard(
  admin: SupabaseClient,
  actor: BoardActor
): Promise<BoardRow | null> {
  if (!actor.orgId && !actor.bankId) return null

  const scopeColumn = actor.orgId ? 'org_id' : 'bank_id'
  const scopeValue = actor.orgId ?? actor.bankId

  const { data: existing } = await admin
    .from('boards')
    .select('*')
    .eq(scopeColumn, scopeValue)
    .maybeSingle()

  if (existing) return existing

  const { data: created, error } = await admin
    .from('boards')
    .insert({
      org_id: actor.orgId,
      bank_id: actor.orgId ? null : actor.bankId,
      created_by_user_id: actor.userId,
    })
    .select()
    .single()

  if (error || !created) {
    // Race: another request created it concurrently — read it back instead of failing.
    const { data: raced } = await admin
      .from('boards')
      .select('*')
      .eq(scopeColumn, scopeValue)
      .maybeSingle()
    return raced ?? null
  }

  const { data: columns } = await admin
    .from('board_columns')
    .insert(DEFAULT_COLUMNS.map((name, position) => ({ board_id: created.id, name, position })))
    .select('id, position')
    .order('position', { ascending: true })

  if (columns && columns.length === DEFAULT_COLUMNS.length) {
    const [first, second, third] = columns as { id: string; position: number }[]
    if (first && second && third) {
      await admin.from('board_column_edges').insert([
        { board_id: created.id, from_column_id: first.id, to_column_id: second.id },
        { board_id: created.id, from_column_id: second.id, to_column_id: third.id },
      ])
    }
  }

  return created
}

/** Resolves a board owned by the actor's org/bank, or null if it doesn't belong to them. */
export async function getOwnBoard(
  admin: SupabaseClient,
  actor: BoardActor,
  boardId: string
): Promise<BoardRow | null> {
  const { data: board } = await admin
    .from('boards')
    .select('*')
    .eq('id', boardId)
    .single()
  if (!board) return null
  if (actor.orgId && board.org_id === actor.orgId) return board
  if (actor.bankId && board.bank_id === actor.bankId) return board
  return null
}

/**
 * Shared auth boilerplate for every /api/board* route: session → users row →
 * BoardActor. Kept here (not a generic cross-cutting auth helper) the same
 * way lib/networks/access.ts holds network-specific access logic — the
 * repo's convention only rejects a generic lib/api-auth.ts, not
 * feature-scoped helpers like this one.
 */
export async function loadBoardActor(
  admin: SupabaseClient
): Promise<{ actor: BoardActor } | { error: NextResponse }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: me } = await admin
    .from('users')
    .select('id, role, org_id, bank_id')
    .eq('id', user.id)
    .single()
  if (!me) return { error: NextResponse.json({ error: 'User not found' }, { status: 401 }) }

  return { actor: { userId: me.id, role: me.role, orgId: me.org_id, bankId: me.bank_id } }
}

export async function fetchBoardData(admin: SupabaseClient, boardId: string) {
  const [{ data: columns }, { data: edges }, { data: tasks }] = await Promise.all([
    admin.from('board_columns').select('*').eq('board_id', boardId).order('position', { ascending: true }),
    admin.from('board_column_edges').select('*').eq('board_id', boardId),
    admin
      .from('board_tasks')
      .select('*, assignee:assignee_user_id(id, full_name, email)')
      .eq('board_id', boardId)
      .order('position', { ascending: true }),
  ])

  return {
    columns: columns ?? [],
    edges: edges ?? [],
    tasks: tasks ?? [],
  }
}
