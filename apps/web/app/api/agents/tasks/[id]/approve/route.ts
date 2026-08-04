import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { executeApproval } from '@/lib/ai/agent-approve'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

  // Load and verify the task belongs to this org
  const { data: task } = await adminClient
    .from('agent_tasks')
    .select('*')
    .eq('id', id)
    .eq('org_id', userData.org_id)
    .single()

  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  if (task.status !== 'awaiting_approval')
    return NextResponse.json({ error: 'Task is not awaiting approval' }, { status: 400 })

  const outcome = await executeApproval(task, userData.id)
  return NextResponse.json(outcome)
}
