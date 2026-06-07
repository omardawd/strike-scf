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

  const { data: orgs, error } = await adminClient
    .from('organizations')
    .select('id, legal_name, doing_business_as, type, kyb_status, kyb_submitted_at, risk_score, risk_flags, primary_contact_email, primary_contact_name, network_visible, status')
    .eq('kyb_status', 'under_review')
    .order('kyb_submitted_at', { ascending: true })

  if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  return NextResponse.json({ orgs: orgs ?? [] })
}
