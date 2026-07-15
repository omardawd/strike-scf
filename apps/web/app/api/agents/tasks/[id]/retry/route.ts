import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Reset a failed task back to awaiting_approval so it can be re-attempted.
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
    .select('id, status, org_id')
    .eq('id', id)
    .eq('org_id', userData.org_id)
    .single()

  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  if (!['failed', 'rejected'].includes(task.status)) {
    return NextResponse.json({ error: 'Only failed or rejected tasks can be retried' }, { status: 400 })
  }

  await adminClient.from('agent_tasks').update({
    status: 'awaiting_approval',
    result: null,
    approved_by_user_id: null,
    approved_at: null,
    rejected_reason: null,
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  return NextResponse.json({ success: true })
}
