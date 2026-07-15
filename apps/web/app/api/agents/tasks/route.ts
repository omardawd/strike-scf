import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Returns one card per THREAD (root task + any escalation/finalization
// follow-ups it produced), not one row per agent_tasks record — a thread whose
// root is 'executing' but has a pending escalation shows the escalation's
// status/content, since that's what actually needs the human's attention.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, org_id')
    .eq('id', user.id)
    .single()

  if (!userData?.org_id) return NextResponse.json({ error: 'No org' }, { status: 400 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')   // 'awaiting_approval' | 'completed' | null (all)
  const limit  = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 100)

  // agent_negotiations embeds the live progress of any 'executing' task (round,
  // halt state, last tick) in the same call — the UI needs this to render
  // progress without a second round-trip per task. Over-fetch relative to
  // `limit` since multiple rows (root + follow-ups) collapse into one card.
  const { data: rows, error } = await adminClient
    .from('agent_tasks')
    .select('*, agent_negotiations(id, status, current_round, last_tick_at, halt_requested, outcome_summary)')
    .eq('org_id', userData.org_id)
    .order('created_at', { ascending: false })
    .limit(limit * 3)

  if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byRoot = new Map<string, any[]>()
  for (const row of rows ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = row as any
    const rootId = (r.root_task_id as string | null) ?? (r.id as string)
    if (!byRoot.has(rootId)) byRoot.set(rootId, [])
    byRoot.get(rootId)!.push(r)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cards: any[] = []
  for (const [rootId, group] of byRoot) {
    group.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    const root = group.find((t) => t.id === rootId) ?? group[0]
    const latest = group[group.length - 1]
    if (!root) continue

    cards.push({
      id: rootId,
      active_task_id: latest.id,
      org_id: root.org_id,
      type: latest.type,
      title: root.title,
      body: root.body,
      status: latest.status,
      proposed_action: latest.proposed_action,
      plan: latest.plan,
      result: latest.result,
      created_at: root.created_at,
      updated_at: latest.updated_at,
      approved_at: latest.approved_at,
      rejected_reason: latest.rejected_reason,
      negotiation: latest.agent_negotiations?.[0] ?? root.agent_negotiations?.[0] ?? null,
    })
  }

  if (status) cards = cards.filter((c) => c.status === status)
  cards.sort((a, b) => new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime())
  cards = cards.slice(0, limit)

  const pending   = cards.filter((c) => c.status === 'awaiting_approval').length
  const completed = cards.filter((c) => c.status === 'completed').length

  return NextResponse.json({ tasks: cards, counts: { pending, completed } })
}
