import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { assertDemoRoutesEnabled, isDemoAccount } from '@/lib/demo'
import { DEMO_ALL_ORG_IDS } from '@/lib/demo-entities'
import { executeApproval } from '@/lib/ai/agent-approve'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/demo/approve-task — demo-only cross-org GATE-2 approval, body: { taskId }.
// The real approval route (app/api/agents/tasks/[id]/approve/route.ts) only lets a session
// approve a task belonging to ITS OWN org — correct in production, since a real Harborview user
// should never be able to approve Ironbridge's internal decisions. But finalization can be
// recommended from EITHER side of a negotiation (see runListingDefenseTick in
// lib/ai/agent-tick.ts): when the counterparty (listing owner) decides to accept, that finalize
// task is created under THEIR org, not the demo login's — and no counterparty session exists in
// this demo to click its own approve button. Since this is a fully isolated, fictional demo
// tenant, this route lets the demo tour approve a task belonging to ANY of the demo tenant's
// orgs — gated to the demo account AND to DEMO_ALL_ORG_IDS specifically so it can never touch a
// real org's task.
export async function POST(req: NextRequest) {
  const disabled = assertDemoRoutesEnabled()
  if (disabled) return disabled

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient.from('users').select('id, email').eq('id', user.id).single()
  if (!me || !isDemoAccount(me.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const taskId = body?.taskId as string | undefined
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })

  const { data: task } = await adminClient.from('agent_tasks').select('*').eq('id', taskId).single()
  if (!task || !DEMO_ALL_ORG_IDS.includes(task.org_id as string)) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }
  if (task.status !== 'awaiting_approval') {
    return NextResponse.json({ error: 'Task is not awaiting approval' }, { status: 400 })
  }

  const outcome = await executeApproval(task, me.id)
  return NextResponse.json(outcome)
}
