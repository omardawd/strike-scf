import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ADMIN_ROLES = ['bank_admin', 'bank_credit_officer', 'org_admin']
const BANK_ROLES  = ['bank_admin', 'bank_credit_officer']

const MEMBER_ROLE_FOR: Record<string, string> = {
  bank_admin:          'bank_credit_officer',
  bank_credit_officer: 'bank_credit_officer',
  org_admin:           'org_member',
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: adminUser, error: adminError } = await adminClient
    .from('users')
    .select('id, role, bank_id, org_id')
    .eq('id', user.id)
    .single()

  if (adminError || !adminUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 401 })
  }

  if (!ADMIN_ROLES.includes(adminUser.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const email    = typeof body.email     === 'string' ? body.email.toLowerCase().trim() : ''
  const password = typeof body.password  === 'string' ? body.password : ''
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  const isBank = BANK_ROLES.includes(adminUser.role)

  // Check if email already exists in same org/bank
  const dupQuery = isBank
    ? adminClient.from('users').select('id').eq('email', email).eq('bank_id', adminUser.bank_id)
    : adminClient.from('users').select('id').eq('email', email).eq('org_id', adminUser.org_id)

  const { data: existing } = await dupQuery.maybeSingle()
  if (existing) {
    return NextResponse.json({ error: 'A user with this email already exists in your organization' }, { status: 400 })
  }

  const memberRole = MEMBER_ROLE_FOR[adminUser.role]

  // Create the auth user — email_confirm skips the verification email
  const { data: authData, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName || undefined,
      role: memberRole,
      ...(isBank ? { bank_id: adminUser.bank_id } : {}),
    },
  })

  if (createError || !authData.user) {
    console.error('Create user error:', createError)
    return NextResponse.json(
      { error: createError?.message ?? 'Failed to create account' },
      { status: 500 }
    )
  }

  const newUserId = authData.user.id

  // The DB trigger creates the public.users row; patch in role + org/bank assignment explicitly
  // Role must be set directly — the trigger may not copy it from user_metadata
  const patch: Record<string, unknown> = { is_active: true, role: memberRole }
  if (fullName) patch.full_name = fullName
  if (isBank) {
    patch.bank_id = adminUser.bank_id
  } else {
    patch.org_id = adminUser.org_id
  }

  const { error: patchError } = await adminClient
    .from('users')
    .upsert({ id: newUserId, email, ...patch }, { onConflict: 'id' })

  if (patchError) {
    console.error('Patch user org/bank error:', patchError)
    // Non-fatal — user created; admin can re-assign if needed
  }

  return NextResponse.json({ success: true }, { status: 201 })
}
