import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES   = ['bank_admin', 'bank_credit_officer']
const ANCHOR_ROLES = ['anchor_admin', 'anchor_member']

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData, error: userError } = await adminClient
    .from('users')
    .select('id, role, bank_id, org_id, email')
    .eq('id', user.id)
    .single()

  if (userError || !userData) {
    return NextResponse.json({ error: 'User not found' }, { status: 401 })
  }

  const { data: program, error: programError } = await adminClient
    .from('programs')
    .select('*')
    .eq('id', id)
    .single()

  if (programError || !program) {
    return NextResponse.json({ error: 'Program not found' }, { status: 404 })
  }

  if (BANK_ROLES.includes(userData.role)) {
    if (program.bank_id !== userData.bank_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  } else {
    // Allow active enrollments OR pending/accepted invitations (invited user viewing before approval).
    // Anchors: match by anchor_org_id (covers both their own row and supplier rows under them).
    // Suppliers: match by org_id.
    const isAnchor = ANCHOR_ROLES.includes(userData.role)

    // public.users.email may be null for older invited users — fall back to auth.users
    let userEmail = userData.email as string | null
    if (!userEmail) {
      const { data: authUser } = await adminClient.auth.admin.getUserById(user.id)
      userEmail = authUser?.user?.email ?? null
    }

    const [enrollResult, inviteResult] = await Promise.all([
      isAnchor
        ? adminClient
            .from('program_enrollments')
            .select('id')
            .eq('program_id', id)
            .eq('anchor_org_id', userData.org_id)
            .eq('status', 'active')
            .limit(1)
            .maybeSingle()
        : adminClient
            .from('program_enrollments')
            .select('id')
            .eq('program_id', id)
            .eq('org_id', userData.org_id)
            .eq('status', 'active')
            .limit(1)
            .maybeSingle(),
      userEmail
        ? adminClient
            .from('invitations')
            .select('id')
            .eq('program_id', id)
            .eq('email', userEmail)
            .in('status', ['pending', 'accepted'])
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ])

    if (!enrollResult.data && !inviteResult.data) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const { count: enrollment_count } = await adminClient
    .from('program_enrollments')
    .select('*', { count: 'exact', head: true })
    .eq('program_id', id)
    .eq('status', 'active')

  return NextResponse.json({ program, enrollment_count: enrollment_count ?? 0 })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData, error: userError } = await adminClient
    .from('users')
    .select('id, role, bank_id')
    .eq('id', user.id)
    .single()

  if (userError || !userData) {
    return NextResponse.json({ error: 'User not found' }, { status: 401 })
  }

  if (userData.role !== 'bank_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: existing, error: existError } = await adminClient
    .from('programs')
    .select('id, bank_id')
    .eq('id', id)
    .single()

  if (existError || !existing) {
    return NextResponse.json({ error: 'Program not found' }, { status: 404 })
  }

  if (existing.bank_id !== userData.bank_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const ALLOWED = ['name', 'status', 'program_limit', 'per_supplier_sublimit', 'min_deal_size', 'max_deal_size', 'standard_tenor_days', 'financing_types']
  const updates: Record<string, unknown> = {}
  for (const key of ALLOWED) {
    if (key in body) updates[key] = body[key]
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { data: program, error } = await adminClient
    .from('programs')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Update program error:', error)
    return NextResponse.json({ error: 'Failed to update program' }, { status: 500 })
  }

  return NextResponse.json({ program })
}
