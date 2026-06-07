import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { OrgType, OrgStatus, KybStatus, UserRole } from '@strike-scf/types'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Self-registration. No invitation tokens, no bank gate. Every organization
// registers itself: org_type 'anchor'/'supplier' creates an org_admin + a
// pending-KYB organization; 'bank' creates a bank_admin lead (Strike sets up
// the bank account manually — there is no organization for banks).
type SignupOrgType = 'anchor' | 'supplier' | 'bank'

interface RegisterBody {
  full_name?: string
  email?: string
  password?: string
  org_type?: SignupOrgType
}

export async function POST(request: Request) {
  let body: RegisterBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const fullName = body.full_name?.trim()
  const email = body.email?.trim().toLowerCase()
  const password = body.password
  const orgType = body.org_type

  if (!fullName || !email || !password || !orgType) {
    return NextResponse.json({ error: 'All fields are required.' }, { status: 400 })
  }
  if (!['anchor', 'supplier', 'bank'].includes(orgType)) {
    return NextResponse.json({ error: 'Invalid account type.' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
  }

  const role: UserRole = orgType === 'bank' ? 'bank_admin' : 'org_admin'

  // 1. Create the auth user.
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role, org_type: orgType },
  })

  if (createError || !created?.user) {
    const msg = createError?.message ?? 'Failed to create account.'
    const alreadyExists = /already (been )?registered|already.*exists|duplicate/i.test(msg)
    return NextResponse.json(
      { error: alreadyExists ? 'An account with this email already exists.' : msg },
      { status: alreadyExists ? 409 : 400 },
    )
  }

  const userId = created.user.id

  // 2. Bank lead — upsert the users row with no org context (bank_id is provisioned
  //    manually by Strike later). The users_context_check constraint allows bank roles
  //    with null bank_id during initial setup.
  if (orgType === 'bank') {
    const { error: userRowError } = await adminClient
      .from('users')
      .upsert(
        { id: userId, email, full_name: fullName, role, is_active: true },
        { onConflict: 'id' },
      )
    if (userRowError) {
      console.error('[auth/register] users upsert error (bank):', userRowError)
      await adminClient.auth.admin.deleteUser(userId)
      return NextResponse.json({ error: 'Failed to create user profile.' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, account_type: 'bank' }, { status: 201 })
  }

  // 3. Anchor / supplier — create the org FIRST so org_id is available when we
  //    upsert the users row. The users_context_check constraint requires org_admin
  //    rows to have org_id set; inserting the user with null org_id fails.
  const orgRow = {
    type: orgType satisfies OrgType,
    status: 'pending_kyb' satisfies OrgStatus,
    kyb_status: 'not_started' satisfies KybStatus,
    primary_contact_name: fullName,
    primary_contact_email: email,
  }

  const { data: org, error: orgError } = await adminClient
    .from('organizations')
    .insert(orgRow)
    .select('id')
    .single()

  if (orgError || !org) {
    console.error('[auth/register] org insert error:', orgError)
    await adminClient.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: 'Failed to create organization.' }, { status: 500 })
  }

  // 4. Upsert the users row with org_id already set so the check constraint passes.
  const { error: userRowError } = await adminClient
    .from('users')
    .upsert(
      { id: userId, email, full_name: fullName, role, org_id: org.id, is_active: true },
      { onConflict: 'id' },
    )

  if (userRowError) {
    console.error('[auth/register] users upsert error:', userRowError)
    // Roll back both the auth user and the org row.
    await Promise.all([
      adminClient.auth.admin.deleteUser(userId),
      adminClient.from('organizations').delete().eq('id', org.id),
    ])
    return NextResponse.json({ error: 'Failed to create user profile.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, account_type: 'org', org_id: org.id }, { status: 201 })
}
