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
    .select('id, role, bank_id, org_id, email')
    .eq('id', user.id)
    .single()

  if (userError || !userData) {
    return NextResponse.json({ error: 'User not found' }, { status: 401 })
  }

  if (BANK_ROLES.includes(userData.role)) {
    const { data: programs, error } = await adminClient
      .from('programs')
      .select('*')
      .eq('bank_id', userData.bank_id)
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: 'Failed to fetch programs' }, { status: 500 })
    return NextResponse.json({ programs: programs ?? [] })
  }

  if (!userData.org_id) {
    return NextResponse.json({ programs: [] })
  }

  const [enrollResult, inviteResult] = await Promise.all([
    adminClient
      .from('program_enrollments')
      .select('program_id')
      .eq('org_id', userData.org_id)
      .eq('status', 'active'),
    userData.email
      ? adminClient
          .from('invitations')
          .select('program_id')
          .eq('email', userData.email as string)
          .in('status', ['pending', 'accepted'])
      : Promise.resolve({ data: [] as Array<{ program_id: string | null }>, error: null }),
  ])

  if (enrollResult.error) return NextResponse.json({ error: 'Failed to fetch enrollments' }, { status: 500 })

  const enrolledIds = (enrollResult.data ?? []).map((e: { program_id: string }) => e.program_id).filter(Boolean)
  const invitedIds  = (inviteResult.data ?? []).map((e: { program_id: string | null }) => e.program_id).filter(Boolean) as string[]
  const programIds  = [...new Set([...enrolledIds, ...invitedIds])]

  if (programIds.length === 0) return NextResponse.json({ programs: [] })

  const { data: programs, error: progError } = await adminClient
    .from('programs')
    .select('*')
    .in('id', programIds)
    .order('created_at', { ascending: false })

  if (progError) return NextResponse.json({ error: 'Failed to fetch programs' }, { status: 500 })
  return NextResponse.json({ programs: programs ?? [] })
}

export async function POST(request: Request) {
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

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { name, financing_types, standard_tenor_days } = body

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!financing_types || !Array.isArray(financing_types) || financing_types.length === 0) {
    return NextResponse.json({ error: 'financing_types must be a non-empty array' }, { status: 400 })
  }
  if (!standard_tenor_days || typeof standard_tenor_days !== 'number') {
    return NextResponse.json({ error: 'standard_tenor_days is required' }, { status: 400 })
  }

  const { data: program, error } = await adminClient
    .from('programs')
    .insert({
      bank_id: userData.bank_id,
      created_by_user_id: userData.id,
      name: (name as string).trim(),
      financing_types,
      standard_tenor_days,
      program_limit: body.program_limit ?? null,
      per_supplier_sublimit: body.per_supplier_sublimit ?? null,
      min_deal_size: body.min_deal_size ?? null,
      max_deal_size: body.max_deal_size ?? null,
      currency: (body.currency as string) ?? 'USD',
      status: 'draft',
    })
    .select()
    .single()

  if (error) {
    console.error('Insert program error:', error)
    return NextResponse.json({ error: 'Failed to create program' }, { status: 500 })
  }

  return NextResponse.json({ program_id: program.id, program }, { status: 201 })
}
