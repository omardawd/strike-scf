import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { completeCycleOccurrence } from '@/lib/deals/flow'

const adminClient = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; occurrenceId: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: userData } = await adminClient.from('users').select('id, org_id').eq('id', user.id).single()
  if (!userData?.org_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { id, occurrenceId } = await params
    const body = await request.json().catch(() => ({}))
    if (body.status !== 'completed') {
      return NextResponse.json({ error: 'status must be completed' }, { status: 400 })
    }
    const occurrence = await completeCycleOccurrence({
      dealId: id,
      occurrenceId,
      actor: { userId: userData.id, orgId: userData.org_id },
    })
    return NextResponse.json({ occurrence })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed'
    return NextResponse.json({ error: message }, { status: message === 'Forbidden' ? 403 : 400 })
  }
}
