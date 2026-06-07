import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })
  if (userData.role !== 'strike_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const [totalOrgsRes, activeOrgsRes, openFinancingRes, dealsThisMonthRes] = await Promise.all([
    adminClient.from('organizations').select('id', { count: 'exact', head: true }),
    adminClient.from('organizations').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    adminClient.from('financing_requests').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    adminClient.from('deals').select('id', { count: 'exact', head: true }).gte('created_at', monthStart),
  ])

  return NextResponse.json({
    total_orgs:              totalOrgsRes.count ?? 0,
    active_orgs:             activeOrgsRes.count ?? 0,
    open_financing_requests: openFinancingRes.count ?? 0,
    deals_this_month:        dealsThisMonthRes.count ?? 0,
  })
}
