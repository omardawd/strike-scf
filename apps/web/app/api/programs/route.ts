import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES   = ['bank_admin', 'bank_credit_officer']
const ANCHOR_ROLES = ['anchor_admin', 'anchor_member']

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

  const isAnchor = ANCHOR_ROLES.includes(userData.role)

  // Anchors: query by anchor_org_id — catches both self-enrollment rows and supplier rows under this anchor
  if (isAnchor) {
    const { data: enrollments } = await adminClient
      .from('program_enrollments')
      .select('program_id')
      .eq('anchor_org_id', userData.org_id)
      .in('status', ['active', 'invited', 'onboarding'])

    const programIds = [...new Set((enrollments ?? []).map((e: { program_id: string }) => e.program_id).filter(Boolean))]

    if (programIds.length === 0) return NextResponse.json({ programs: [] })

    const { data: programs, error: progError } = await adminClient
      .from('programs')
      .select('*')
      .in('id', programIds)
      .eq('status', 'active')

    if (progError) return NextResponse.json({ error: 'Failed to fetch programs' }, { status: 500 })
    return NextResponse.json({ programs: programs ?? [] })
  }

  // Suppliers: query by org_id + email invitations
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
    .select('id, role, bank_id, org_id')
    .eq('id', user.id)
    .single()

  if (userError || !userData) {
    return NextResponse.json({ error: 'User not found' }, { status: 401 })
  }

  const isBank   = userData.role === 'bank_admin'
  const isAnchor = userData.role === 'anchor_admin'

  if (!isBank && !isAnchor) {
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

  if (isAnchor) {
    const types = financing_types as string[]
    if (!types.every((t: string) => t === 'dynamic_discounting')) {
      return NextResponse.json(
        { error: 'Anchors can only create dynamic discounting programs' },
        { status: 403 }
      )
    }
  }

  const isDDOnly = (financing_types as string[]).every((t: string) => t === 'dynamic_discounting')
  if (!isDDOnly && (!standard_tenor_days || typeof standard_tenor_days !== 'number')) {
    return NextResponse.json({ error: 'standard_tenor_days is required' }, { status: 400 })
  }

  let effectiveBankId = userData.bank_id
  if (isAnchor) {
    const { data: anchorOrg } = await adminClient
      .from('organizations')
      .select('bank_id')
      .eq('id', userData.org_id)
      .single()
    effectiveBankId = anchorOrg?.bank_id ?? userData.bank_id
  }

  const { data: program, error } = await adminClient
    .from('programs')
    .insert({
      bank_id:              effectiveBankId,
      anchor_org_id:        isAnchor ? userData.org_id : null,
      created_by_user_id:   userData.id,
      name:                 (name as string).trim(),
      financing_types,
      standard_tenor_days:  (standard_tenor_days as number) ?? 0,
      program_limit:        body.program_limit ?? null,
      per_supplier_sublimit: body.per_supplier_sublimit ?? null,
      min_deal_size:        body.min_deal_size ?? null,
      max_deal_size:        body.max_deal_size ?? null,
      currency:             (body.currency as string) ?? 'USD',
      status:               'draft',
      discount_schedule:    body.discount_schedule ?? null,
    })
    .select()
    .single()

  if (error) {
    console.error('Insert program error:', error)
    return NextResponse.json({ error: 'Failed to create program' }, { status: 500 })
  }

  if (isAnchor && program) {
    await adminClient.from('program_enrollments').insert({
      program_id:          program.id,
      org_id:              userData.org_id,
      anchor_org_id:       userData.org_id,
      enrolled_by_user_id: user.id,
      status:              'active',
      enrolled_at:         new Date().toISOString(),
    }).catch(() => {})
  }

  return NextResponse.json({ program_id: program.id, program }, { status: 201 })
}
