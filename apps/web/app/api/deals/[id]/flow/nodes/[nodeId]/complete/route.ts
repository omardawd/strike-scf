import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { completeFlowNode } from '@/lib/deals/flow'

const adminClient = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function POST(_request: Request, { params }: { params: Promise<{ id: string; nodeId: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: userData } = await adminClient.from('users').select('id, org_id').eq('id', user.id).single()
  if (!userData?.org_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { id, nodeId } = await params
    const node = await completeFlowNode({
      dealId: id,
      nodeId,
      actor: { userId: userData.id, orgId: userData.org_id },
    })
    return NextResponse.json({ node })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed'
    return NextResponse.json({ error: message }, { status: message === 'Forbidden' ? 403 : 400 })
  }
}
