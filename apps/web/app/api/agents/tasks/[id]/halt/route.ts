import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// "Stop negotiation" — the [id] here is the originating agent_tasks row (the
// one showing status 'executing' in the UI). Sets halt_requested on the linked
// agent_negotiations row; the next tick sees it and halts (status:'halted_by_user').
export async function POST(
  _req: NextRequest,
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

  const { data: task } = await adminClient
    .from('agent_tasks')
    .select('id, org_id, status')
    .eq('id', id)
    .eq('org_id', userData.org_id)
    .single()

  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  if (task.status !== 'executing')
    return NextResponse.json({ error: 'Task is not an active negotiation' }, { status: 400 })

  const { data: negotiation } = await adminClient
    .from('agent_negotiations')
    .select('id, status')
    .eq('agent_task_id', id)
    .eq('org_id', userData.org_id)
    .single()

  if (!negotiation) return NextResponse.json({ error: 'No active negotiation found for this task' }, { status: 404 })
  if (negotiation.status !== 'active')
    return NextResponse.json({ error: 'Negotiation is not active' }, { status: 400 })

  await adminClient.from('agent_negotiations').update({
    halt_requested: true,
    halt_requested_by: userData.id,
    updated_at: new Date().toISOString(),
  }).eq('id', negotiation.id)

  return NextResponse.json({ success: true })
}
