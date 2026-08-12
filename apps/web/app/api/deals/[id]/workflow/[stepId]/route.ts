import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { respondToWorkflowStep } from '@/lib/deals/workflow'
import { assertOrgCanExpandDeal } from '@/lib/deals/admission-policy'

const adminClient = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; stepId: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: userData } = await adminClient.from('users').select('id, org_id').eq('id', user.id).single()
  if (!userData?.org_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { id, stepId } = await params
    const body = await request.json()
    if (!['accepted', 'declined'].includes(body.response)) {
      return NextResponse.json({ error: 'response must be accepted or declined' }, { status: 400 })
    }
    // Declining a proposed step is always allowed; accepting one commits to
    // an optional addition, so it requires admission like proposing does.
    if (body.response === 'accepted') {
      const admissionError = await assertOrgCanExpandDeal(adminClient, userData.org_id, 'accept a workflow step')
      if (admissionError) return NextResponse.json({ error: admissionError }, { status: 403 })
    }
    const step = await respondToWorkflowStep({
      dealId: id,
      stepId,
      actor: { userId: userData.id, orgId: userData.org_id },
      response: body.response,
    })
    return NextResponse.json({ step })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed'
    return NextResponse.json({ error: message }, { status: message.startsWith('Only the supplier') ? 403 : 400 })
  }
}
