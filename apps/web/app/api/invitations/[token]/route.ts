import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BANK_ROLES = ['bank_admin', 'bank_credit_officer']

async function fetchValidInvitation(token: string) {
  const { data, error } = await adminClient
    .from('invitations')
    .select('id, email, role, expires_at, bank_id, anchor_org_id, status')
    .eq('token', token)
    .eq('status', 'pending')
    .single()

  if (error || !data) return null
  if (new Date(data.expires_at) < new Date()) return null
  return data
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const { data, error } = await adminClient
    .from('invitations')
    .select('id, email, role, expires_at, bank_id, anchor_org_id, status')
    .eq('token', token)
    .eq('status', 'pending')
    .single()

  if (error || !data) {
    return NextResponse.json({ valid: false, reason: 'not_found' })
  }

  if (new Date(data.expires_at) < new Date()) {
    return NextResponse.json({ valid: false, reason: 'expired' })
  }

  return NextResponse.json({
    valid: true,
    invitation: {
      email: data.email,
      role: data.role,
      expires_at: data.expires_at,
      bank_id: data.bank_id,
      anchor_org_id: data.anchor_org_id,
    },
  })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const invitation = await fetchValidInvitation(token)
  if (!invitation) {
    return NextResponse.json(
      { error: 'Invitation not found, already used, or expired' },
      { status: 404 }
    )
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!fullName || fullName.length < 2) {
    return NextResponse.json({ error: 'Full name is required' }, { status: 400 })
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  // Create Supabase auth user
  const { data: authData, error: createError } = await adminClient.auth.admin.createUser({
    email: invitation.email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      role: invitation.role,
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

  // Set bank_id or org_id on the public.users row (auth trigger inserts the row
  // but doesn't know about invitations, so we patch org/bank separately)
  const userUpdate: Record<string, unknown> = {}
  if (BANK_ROLES.includes(invitation.role)) {
    userUpdate.bank_id = invitation.bank_id
  } else {
    userUpdate.org_id = invitation.anchor_org_id
  }

  if (Object.keys(userUpdate).length > 0) {
    const { error: updateError } = await adminClient
      .from('users')
      .update(userUpdate)
      .eq('id', newUserId)

    if (updateError) {
      // Non-fatal — user was created; org assignment failed but can be fixed manually
      console.error('Update user org/bank error:', updateError)
    }
  }

  // Mark invitation accepted
  const { error: acceptError } = await adminClient
    .from('invitations')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', invitation.id)

  if (acceptError) {
    console.error('Mark invitation accepted error:', acceptError)
  }

  return NextResponse.json({ success: true })
}
