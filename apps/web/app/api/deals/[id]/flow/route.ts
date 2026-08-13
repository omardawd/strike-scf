import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { listDealFlow, saveDealFlow } from '@/lib/deals/flow'
import { assertOrgCanExpandDeal } from '@/lib/deals/admission-policy'

const adminClient = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function actor() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await adminClient.from('users').select('id, org_id').eq('id', user.id).single()
  return data?.org_id ? { userId: data.id, orgId: data.org_id } : null
}

function flowError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Request failed'
  const status = message === 'Deal not found' ? 404 : message === 'Forbidden' || message.startsWith('Only the buyer') ? 403 : 400
  return NextResponse.json({ error: message }, { status })
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const currentActor = await actor()
  if (!currentActor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { id } = await params
    return NextResponse.json(await listDealFlow(id, currentActor.orgId))
  } catch (error) { return flowError(error) }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const currentActor = await actor()
  if (!currentActor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Redesigning the deal's flow is an optional expansion of the deal, not a
  // necessary fulfillment action — same admission gate as proposing a
  // workflow step. See lib/deals/admission-policy.ts.
  const admissionError = await assertOrgCanExpandDeal(adminClient, currentActor.orgId, 'edit the deal flow')
  if (admissionError) return NextResponse.json({ error: admissionError }, { status: 403 })
  try {
    const { id } = await params
    const body = await request.json()
    const flow = await saveDealFlow({
      dealId: id,
      actor: currentActor,
      nodes: Array.isArray(body.nodes) ? body.nodes : [],
      edges: Array.isArray(body.edges) ? body.edges : undefined,
      source: 'manual',
    })
    return NextResponse.json(flow)
  } catch (error) { return flowError(error) }
}
