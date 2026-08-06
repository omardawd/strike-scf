import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES = ['bank_admin', 'bank_credit_officer']
const ORG_ROLES  = ['org_admin', 'org_member']

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

  // Any org can be enrolled as the anchor side on one program and the org_id
  // side on another (and can hold either-role invitations) — check every
  // access pattern rather than picking one path via org-level type.
  const [byAnchorId, byOrgId, byAnchorInvite, byOtherInvite] = await Promise.all([
    adminClient
      .from('program_enrollments')
      .select('program_id')
      .eq('anchor_org_id', userData.org_id)
      .in('status', ['active', 'invited', 'onboarding']),
    adminClient
      .from('program_enrollments')
      .select('program_id')
      .eq('org_id', userData.org_id)
      .in('status', ['active', 'invited', 'onboarding']),
    userData.email
      ? adminClient
          .from('invitations')
          .select('program_id')
          .eq('email', userData.email as string)
          .eq('role', 'anchor')
          .in('status', ['pending', 'accepted'])
          .not('program_id', 'is', null)
      : Promise.resolve({ data: [] as Array<{ program_id: string | null }>, error: null }),
    userData.email
      ? adminClient
          .from('invitations')
          .select('program_id')
          .eq('email', userData.email as string)
          .in('status', ['pending', 'accepted'])
          .not('program_id', 'is', null)
      : Promise.resolve({ data: [] as Array<{ program_id: string | null }>, error: null }),
  ])

  const allIds = [
    ...(byAnchorId.data ?? []),
    ...(byOrgId.data ?? []),
    ...((byAnchorInvite as { data: Array<{ program_id: string | null }> | null }).data ?? []),
    ...((byOtherInvite as { data: Array<{ program_id: string | null }> | null }).data ?? []),
  ].map((e: any) => e.program_id).filter(Boolean)
  const programIds = [...new Set(allIds)]

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

  // Both bank roles can create programs (credit officers source deals on Strike Place — TC.5).
  // Any org admin can also create a program (self-funded Dynamic Discounting
  // only — see the financing_types check below) — no longer restricted to
  // anchor-type orgs.
  const isBank = userData.role === 'bank_admin' || userData.role === 'bank_credit_officer'
  const isOrgCreator = userData.role === 'org_admin' && !!userData.org_id

  if (!isBank && !isOrgCreator) {
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

  if (isBank) {
    const types = financing_types as string[]
    if (types.includes('dynamic_discounting')) {
      return NextResponse.json(
        { error: 'Banks cannot create dynamic discounting programs. This program type is self-initiated by the organization offering it.' },
        { status: 403 }
      )
    }
  }

  if (isOrgCreator) {
    const types = financing_types as string[]
    if (!types.every((t: string) => t === 'dynamic_discounting')) {
      return NextResponse.json(
        { error: 'Organizations can only self-create dynamic discounting programs — other financing types require a bank.' },
        { status: 403 }
      )
    }
  }

  const isDDOnly = (financing_types as string[]).every((t: string) => t === 'dynamic_discounting')
  if (!isDDOnly && (!standard_tenor_days || typeof standard_tenor_days !== 'number')) {
    return NextResponse.json({ error: 'standard_tenor_days is required' }, { status: 400 })
  }

  let effectiveBankId = userData.bank_id
  if (isOrgCreator) {
    const { data: creatorOrg } = await adminClient
      .from('organizations')
      .select('bank_id')
      .eq('id', userData.org_id)
      .single()
    effectiveBankId = creatorOrg?.bank_id ?? userData.bank_id
  }

  const { data: program, error } = await adminClient
    .from('programs')
    .insert({
      bank_id:              effectiveBankId,
      created_by_user_id:   userData.id,
      name:                 (name as string).trim(),
      financing_types,
      standard_tenor_days:  isDDOnly ? ((standard_tenor_days as number | undefined) ?? 60) : (standard_tenor_days as number),
      program_limit:        body.program_limit ?? null,
      per_supplier_sublimit: body.per_supplier_sublimit ?? null,
      min_deal_size:        body.min_deal_size ?? null,
      max_deal_size:        body.max_deal_size ?? null,
      currency:             (body.currency as string) ?? 'USD',
      status:               isDDOnly ? 'active' : 'draft',
      discount_schedule:    body.discount_schedule ?? null,
    })
    .select()
    .single()

  if (error) {
    console.error('[program create] error:', error)
    return NextResponse.json({ error: 'Failed to create program' }, { status: 500 })
  }

  if (isOrgCreator && program) {
    try {
      await adminClient.from('program_enrollments').insert({
        program_id:          program.id,
        org_id:              userData.org_id,
        anchor_org_id:       userData.org_id,
        enrolled_by_user_id: user.id,
        status:              'active',
        enrolled_at:         new Date().toISOString(),
      })
    } catch {}
  }

  // TC.5 — when this program was created via the Strike AI inline "Create Program"
  // mid-flow on Strike Place, record it to the agent_actions audit log. Fail-soft:
  // if the agent_action_type enum has not yet been extended with 'program_created'
  // on this database, the insert is swallowed and program creation still succeeds.
  if (program && body.agent_origin === 'strike_ai_inline') {
    try {
      await adminClient.from('agent_actions').insert({
        bank_id:        effectiveBankId,
        action_type:    'program_created',
        entity_type:    'program',
        entity_id:      program.id,
        reasoning:      'Bank had no program matching a Strike Place financing request; Strike AI created one inline so an offer could be submitted.',
        input_summary:  `type=${(financing_types as string[]).join(',')} currency=${(body.currency as string) ?? 'USD'}`,
        output_summary: `Created program "${(name as string).trim()}" (${program.id})`,
        outcome:        'success',
        requires_approval: false,
        human_approved: true,
        model:          'claude-haiku-4-5-20251001',
      })
    } catch (err) {
      console.error('[program create] agent_actions log failed (non-fatal):', err)
    }
  }

  return NextResponse.json({ program_id: program.id, program }, { status: 201 })
}
