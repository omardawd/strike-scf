import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { listWorkflowSteps, proposeWorkflowStep } from '@/lib/deals/workflow'

const adminClient = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function actor() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await adminClient.from('users').select('id, org_id').eq('id', user.id).single()
  return data?.org_id ? { userId: data.id, orgId: data.org_id } : null
}

function workflowError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Request failed'
  const status = message === 'Deal not found' ? 404 : message === 'Forbidden' || message.startsWith('Only the buyer') ? 403 : 400
  return NextResponse.json({ error: message }, { status })
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const currentActor = await actor()
  if (!currentActor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { id } = await params
    return NextResponse.json({ steps: await listWorkflowSteps(id, currentActor.orgId) })
  } catch (error) { return workflowError(error) }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const currentActor = await actor()
  if (!currentActor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { id } = await params
    const body = await request.json()
    const step = await proposeWorkflowStep({
      dealId: id,
      actor: currentActor,
      title: body.title ?? '',
      description: body.description,
      responsibleParty: body.responsible_party,
      requiresDocument: body.requires_document,
      dueAt: body.due_at,
    })
    return NextResponse.json({ step }, { status: 201 })
  } catch (error) { return workflowError(error) }
}
