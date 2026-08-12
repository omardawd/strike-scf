import { adminClient } from '../admin'
import { getOrCreateBoard, fetchBoardData, isBoardAdmin, type BoardActor } from '@/lib/board/access'
import type { ToolActor } from './deal-workflow'

// Board tools never accept org_id/bank_id in tool_input — the board is
// always the caller's OWN org/bank board (one per org/bank), resolved
// entirely from `actor` (set by the caller from a real session, never from
// model-controlled input). This sidesteps the whole
// TOOL_ORG_ID_FIELDS/assertActorOwnsToolOrg impersonation class of bug by
// construction — there's no org id for a prompt to spoof.

async function resolveBoardActor(actor?: ToolActor): Promise<BoardActor | null> {
  if (!actor?.userId || (!actor.orgId && !actor.bankId)) return null
  const { data: user } = await adminClient
    .from('users')
    .select('id, role')
    .eq('id', actor.userId)
    .maybeSingle()
  // maybeSingle() -> null for synthetic non-user actor ids (e.g. the
  // negotiation tick loop's 'agent-tick', dispatch's 'dispatch:<org_id>') —
  // Board tools are chat/dispatch-facing only through a real user session,
  // never the tick loop, so treating "no real user row" as "not board admin"
  // is the correct default, not just a fallback.
  return {
    userId: actor.userId,
    role: user?.role ?? '',
    orgId: actor.orgId,
    bankId: actor.bankId,
  }
}

export type GetBoardInput = Record<string, never>

export async function getBoard(_input: GetBoardInput, actor?: ToolActor) {
  const boardActor = await resolveBoardActor(actor)
  if (!boardActor) return { error: 'An authenticated organization or bank user is required' }

  const board = await getOrCreateBoard(adminClient, boardActor)
  if (!board) return { error: 'Board is not available for this account' }

  const { columns, edges, tasks } = await fetchBoardData(adminClient, board.id)
  return {
    board_id: board.id,
    board_name: board.name,
    columns: columns.map((c: { id: string; name: string; position: number }) => ({ id: c.id, name: c.name, position: c.position })),
    edges: edges.map((e: { from_column_id: string; to_column_id: string; label: string | null }) => ({ from_column_id: e.from_column_id, to_column_id: e.to_column_id, label: e.label })),
    tasks: tasks.map((t: { id: string; title: string; column_id: string; assignee?: { full_name: string } | null; priority: string; due_date: string | null }) => ({
      id: t.id,
      title: t.title,
      column_id: t.column_id,
      assignee: t.assignee?.full_name ?? null,
      priority: t.priority,
      due_date: t.due_date,
    })),
    url: '/board',
  }
}

export interface DesignBoardWorkflowInput {
  columns: { name: string; position?: number }[]
  edges?: { from: string; to: string; label?: string }[]
}

// Replaces the board's entire column/edge set atomically — the chat-driven
// "design a workflow" primitive. Any task sitting in a removed column is
// reassigned (matched by column name, case-insensitive; else the first
// remaining column) rather than deleted, since board_tasks.column_id
// cascades on column delete otherwise.
export async function designBoardWorkflow(input: DesignBoardWorkflowInput, actor?: ToolActor) {
  const boardActor = await resolveBoardActor(actor)
  if (!boardActor) return { error: 'An authenticated organization or bank user is required' }
  if (!isBoardAdmin(boardActor.role)) return { error: 'Only org/bank admins can design the workflow' }

  if (!Array.isArray(input.columns) || input.columns.length === 0) {
    return { error: 'At least one column is required' }
  }
  const names = input.columns.map(c => (c.name ?? '').trim())
  if (names.some(n => !n)) return { error: 'Every column needs a non-empty name' }

  const board = await getOrCreateBoard(adminClient, boardActor)
  if (!board) return { error: 'Board is not available for this account' }

  const { data: oldColumns } = await adminClient
    .from('board_columns')
    .select('id, name')
    .eq('board_id', board.id)

  const { data: newColumns, error: insertError } = await adminClient
    .from('board_columns')
    .insert(
      input.columns.map((c, idx) => ({
        board_id: board.id,
        name: c.name.trim(),
        position: c.position ?? idx,
      }))
    )
    .select('id, name, position')

  if (insertError || !newColumns) return { error: `Failed to create stages: ${insertError?.message ?? 'unknown error'}` }

  const byNameLower = new Map<string, { id: string; name: string }>(
    newColumns.map((c: { id: string; name: string }) => [c.name.toLowerCase(), c])
  )
  const firstNewColumn = newColumns[0]

  if (oldColumns && oldColumns.length > 0) {
    for (const old of oldColumns as { id: string; name: string }[]) {
      const match = byNameLower.get(old.name.toLowerCase()) ?? firstNewColumn
      await adminClient.from('board_tasks').update({ column_id: match.id }).eq('column_id', old.id)
    }
    await adminClient.from('board_column_edges').delete().eq('board_id', board.id)
    await adminClient.from('board_columns').delete().in('id', oldColumns.map((c: { id: string }) => c.id))
  }

  if (input.edges?.length) {
    const edgeRows = input.edges
      .map(e => {
        const from = byNameLower.get((e.from ?? '').toLowerCase())
        const to = byNameLower.get((e.to ?? '').toLowerCase())
        if (!from || !to || from.id === to.id) return null
        return { board_id: board.id, from_column_id: from.id, to_column_id: to.id, label: e.label ?? null }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
    if (edgeRows.length > 0) {
      await adminClient.from('board_column_edges').insert(edgeRows)
    }
  }

  return {
    board_id: board.id,
    columns: newColumns.map((c: { id: string; name: string; position: number }) => ({ id: c.id, name: c.name, position: c.position })),
    url: '/board',
  }
}

export interface CreateBoardTaskInput {
  title: string
  column_name?: string
  column_id?: string
  description?: string
  assignee_email?: string
  priority?: 'low' | 'medium' | 'high'
  due_date?: string
}

export async function createBoardTask(input: CreateBoardTaskInput, actor?: ToolActor) {
  const boardActor = await resolveBoardActor(actor)
  if (!boardActor) return { error: 'An authenticated organization or bank user is required' }
  if (!isBoardAdmin(boardActor.role)) return { error: 'Only org/bank admins can create and assign tasks' }

  const title = (input.title ?? '').trim()
  if (!title) return { error: 'title is required' }

  const board = await getOrCreateBoard(adminClient, boardActor)
  if (!board) return { error: 'Board is not available for this account' }

  let columnId = input.column_id ?? null
  if (!columnId && input.column_name) {
    const { data: column } = await adminClient
      .from('board_columns')
      .select('id')
      .eq('board_id', board.id)
      .ilike('name', input.column_name.trim())
      .maybeSingle()
    columnId = column?.id ?? null
  }
  if (!columnId) {
    const { data: firstColumn } = await adminClient
      .from('board_columns')
      .select('id')
      .eq('board_id', board.id)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle()
    columnId = firstColumn?.id ?? null
  }
  if (!columnId) return { error: 'No stage found to place this task in — design the workflow first' }

  let assigneeUserId: string | null = null
  if (input.assignee_email) {
    const scopeColumn = boardActor.orgId ? 'org_id' : 'bank_id'
    const { data: assignee } = await adminClient
      .from('users')
      .select('id')
      .eq('email', input.assignee_email.trim().toLowerCase())
      .eq(scopeColumn, boardActor.orgId ?? boardActor.bankId)
      .maybeSingle()
    if (!assignee) return { error: `No teammate found with email ${input.assignee_email}` }
    assigneeUserId = assignee.id
  }

  const { count } = await adminClient
    .from('board_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('column_id', columnId)

  const { data: task, error } = await adminClient
    .from('board_tasks')
    .insert({
      board_id: board.id,
      column_id: columnId,
      title,
      description: input.description ?? null,
      assignee_user_id: assigneeUserId,
      priority: input.priority ?? 'medium',
      due_date: input.due_date ?? null,
      position: count ?? 0,
      created_by_user_id: boardActor.userId,
    })
    .select('id, title')
    .single()

  if (error || !task) return { error: `Failed to create task: ${error?.message ?? 'unknown error'}` }
  return { task_id: task.id, title: task.title, url: '/board' }
}

export interface AssignBoardTaskInput {
  task_id: string
  assignee_email: string
}

export async function assignBoardTask(input: AssignBoardTaskInput, actor?: ToolActor) {
  const boardActor = await resolveBoardActor(actor)
  if (!boardActor) return { error: 'An authenticated organization or bank user is required' }
  if (!isBoardAdmin(boardActor.role)) return { error: 'Only org/bank admins can assign tasks' }
  if (!input.task_id || !input.assignee_email) return { error: 'task_id and assignee_email are required' }

  const { data: task } = await adminClient.from('board_tasks').select('id, board_id').eq('id', input.task_id).single()
  if (!task) return { error: 'Task not found' }

  const board = await getOrCreateBoard(adminClient, boardActor)
  if (!board || board.id !== task.board_id) return { error: 'Task not found' }

  const scopeColumn = boardActor.orgId ? 'org_id' : 'bank_id'
  const { data: assignee } = await adminClient
    .from('users')
    .select('id, full_name')
    .eq('email', input.assignee_email.trim().toLowerCase())
    .eq(scopeColumn, boardActor.orgId ?? boardActor.bankId)
    .maybeSingle()
  if (!assignee) return { error: `No teammate found with email ${input.assignee_email}` }

  const { error } = await adminClient
    .from('board_tasks')
    .update({ assignee_user_id: assignee.id, updated_at: new Date().toISOString() })
    .eq('id', input.task_id)

  if (error) return { error: `Failed to assign task: ${error.message}` }
  return { task_id: input.task_id, assignee: assignee.full_name, url: '/board' }
}

export interface MoveBoardTaskInput {
  task_id: string
  column_name?: string
  column_id?: string
}

// Open to any board member for their own assigned task, admins can move any
// task — mirrors PATCH /api/board/tasks/[id]'s rule exactly.
export async function moveBoardTask(input: MoveBoardTaskInput, actor?: ToolActor) {
  const boardActor = await resolveBoardActor(actor)
  if (!boardActor) return { error: 'An authenticated organization or bank user is required' }
  if (!input.task_id) return { error: 'task_id is required' }

  const { data: task } = await adminClient
    .from('board_tasks')
    .select('id, board_id, assignee_user_id')
    .eq('id', input.task_id)
    .single()
  if (!task) return { error: 'Task not found' }

  const board = await getOrCreateBoard(adminClient, boardActor)
  if (!board || board.id !== task.board_id) return { error: 'Task not found' }

  const admin = isBoardAdmin(boardActor.role)
  if (!admin && task.assignee_user_id !== boardActor.userId) {
    return { error: 'You can only move tasks assigned to you' }
  }

  let columnId = input.column_id ?? null
  if (!columnId && input.column_name) {
    const { data: column } = await adminClient
      .from('board_columns')
      .select('id')
      .eq('board_id', board.id)
      .ilike('name', input.column_name.trim())
      .maybeSingle()
    columnId = column?.id ?? null
  }
  if (!columnId) return { error: 'Target stage not found — pass column_name or column_id' }

  const { error } = await adminClient
    .from('board_tasks')
    .update({ column_id: columnId, updated_at: new Date().toISOString() })
    .eq('id', input.task_id)

  if (error) return { error: `Failed to move task: ${error.message}` }
  return { task_id: input.task_id, column_id: columnId, url: '/board' }
}
