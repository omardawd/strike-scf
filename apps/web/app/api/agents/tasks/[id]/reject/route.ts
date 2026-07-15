import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { postSystemMessage } from '@/lib/ai/agent-task-chat'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, org_id, role')
    .eq('id', user.id)
    .single()

  if (!userData?.org_id) return NextResponse.json({ error: 'No org' }, { status: 400 })
  if (userData.role !== 'org_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { reason } = await req.json().catch(() => ({}))

  const { data: task } = await adminClient
    .from('agent_tasks')
    .select('id, org_id, status, type, plan, root_task_id')
    .eq('id', id)
    .eq('org_id', userData.org_id)
    .single()

  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  if (task.status !== 'awaiting_approval')
    return NextResponse.json({ error: 'Task is not awaiting approval' }, { status: 400 })

  await adminClient.from('agent_tasks').update({
    status: 'rejected',
    rejected_reason: reason ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  const rootTaskId = (task.root_task_id as string | null) ?? id

  // Follow-up tasks on an existing negotiation (GATE 2 finalization, or an
  // escalation) end the negotiation when the human declines rather than
  // leaving it stuck 'active' with nothing left to approve.
  const negotiationId = (task.plan as { negotiation_id?: string } | null)?.negotiation_id
  if (negotiationId) {
    const endStatus = task.type === 'negotiation_ready_to_finalize' ? 'completed_rejected' : 'halted_by_user'
    await adminClient.from('agent_negotiations').update({
      status: endStatus,
      outcome_summary: reason ? `Rejected by human: ${reason}` : 'Rejected by human.',
      updated_at: new Date().toISOString(),
    }).eq('id', negotiationId)
  }

  await postSystemMessage(rootTaskId, reason ? `Rejected: ${reason}` : 'Rejected.')

  return NextResponse.json({ success: true })
}
