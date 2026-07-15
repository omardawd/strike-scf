import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { resolveRootTaskId, getThread, postUserMessage } from '@/lib/ai/agent-task-chat'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function authOrg() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: userData } = await adminClient
    .from('users')
    .select('id, org_id, role')
    .eq('id', user.id)
    .single()
  return userData ?? null
}

// GET the full thread (root task + any escalation/finalization follow-ups + messages).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const userData = await authOrg()
  if (!userData?.org_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rootTaskId = await resolveRootTaskId(id)
  if (!rootTaskId) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const { rootTask, allTasks, currentTask, messages } = await getThread(rootTaskId)
  if (!rootTask || rootTask.org_id !== userData.org_id) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  return NextResponse.json({ rootTask, tasks: allTasks, currentTask, messages })
}

// POST a user message — Strike AI replies, and may revise the pending action.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const userData = await authOrg()
  if (!userData?.org_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { content } = await req.json().catch(() => ({}))
  if (!content || typeof content !== 'string' || !content.trim()) {
    return NextResponse.json({ error: 'Message content is required' }, { status: 400 })
  }

  const rootTaskId = await resolveRootTaskId(id)
  if (!rootTaskId) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  try {
    const { revised } = await postUserMessage(rootTaskId, userData.org_id, content.trim())
    const thread = await getThread(rootTaskId)
    return NextResponse.json({ revised, ...thread })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send message'
    const status = message === 'Task not found' ? 404 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
