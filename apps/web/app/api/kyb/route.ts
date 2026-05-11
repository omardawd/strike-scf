import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('role, bank_id')
    .eq('id', user.id)
    .single()

  if (!me || (me.role !== 'bank_admin' && me.role !== 'bank_credit_officer')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const statusFilter = searchParams.get('status')

  let query = adminClient
    .from('organizations')
    .select(`
      id, legal_name, type, kyb_status, status,
      kyb_submitted_at, created_at, risk_tier,
      credit_score, ein, city, state,
      users(full_name, email)
    `)
    .eq('bank_id', me.bank_id)

  if (statusFilter) {
    query = query.eq('kyb_status', statusFilter)
  }

  const { data: orgs, error } = await query.order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch organizations' }, { status: 500 })
  }

  const organizations = (orgs ?? []).map((org: Record<string, unknown>) => {
    const usersArr = Array.isArray(org.users) ? org.users : (org.users ? [org.users] : [])
    const contact = usersArr[0] as { full_name?: string; email?: string } | undefined
    return {
      id: org.id,
      legal_name: org.legal_name,
      type: org.type,
      kyb_status: org.kyb_status,
      status: org.status,
      kyb_submitted_at: org.kyb_submitted_at,
      created_at: org.created_at,
      risk_tier: org.risk_tier,
      credit_score: org.credit_score,
      ein: org.ein,
      city: org.city,
      state: org.state,
      primary_contact_name: contact?.full_name ?? null,
      primary_contact_email: contact?.email ?? null,
    }
  })

  return NextResponse.json({ organizations })
}
