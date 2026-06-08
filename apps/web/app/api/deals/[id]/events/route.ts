// GET deal events for the deal timeline.
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, org_id')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: deal } = await adminClient
    .from('deals')
    .select('buyer_org_id, supplier_org_id')
    .eq('id', id)
    .single()
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  if (deal.buyer_org_id !== userData.org_id && deal.supplier_org_id !== userData.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: events } = await adminClient
    .from('deal_events')
    .select('*')
    .eq('deal_id', id)
    .order('created_at', { ascending: false })

  return NextResponse.json({ events: events ?? [] })
}
