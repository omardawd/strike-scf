import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES = ['bank_admin', 'bank_credit_officer']

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData, error: userError } = await adminClient
    .from('users')
    .select('id, role, bank_id, org_id')
    .eq('id', user.id)
    .single()

  if (userError || !userData) {
    return NextResponse.json({ error: 'User not found' }, { status: 401 })
  }

  if (BANK_ROLES.includes(userData.role)) {
    const { data: members, error: membersError } = await adminClient
      .from('users')
      .select('id, full_name, email, role, is_active, created_at')
      .eq('bank_id', userData.bank_id)
      .order('created_at', { ascending: true })

    if (membersError) return NextResponse.json({ error: 'Failed to fetch team' }, { status: 500 })

    const { data: invitations } = await adminClient
      .from('invitations')
      .select('id, email, role, created_at, expires_at, status')
      .eq('bank_id', userData.bank_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    return NextResponse.json({ users: members ?? [], pending_invitations: invitations ?? [] })
  }

  if (!userData.org_id) {
    return NextResponse.json({ users: [], pending_invitations: [] })
  }

  const { data: members, error: membersError } = await adminClient
    .from('users')
    .select('id, full_name, email, role, is_active, created_at')
    .eq('org_id', userData.org_id)
    .order('created_at', { ascending: true })

  if (membersError) return NextResponse.json({ error: 'Failed to fetch team' }, { status: 500 })

  const { data: invitations } = await adminClient
    .from('invitations')
    .select('id, email, role, created_at, expires_at, status')
    .eq('anchor_org_id', userData.org_id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  return NextResponse.json({ users: members ?? [], pending_invitations: invitations ?? [] })
}
