import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendEmail, inviteEmailHtml } from '@/lib/email'
import { rateLimit } from '@/lib/rate-limit'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ADMIN_ROLES = ['bank_admin', 'anchor_admin', 'supplier_admin']
const BANK_ROLES  = ['bank_admin', 'bank_credit_officer']

const ALLOWED_INVITE_ROLES: Record<string, string[]> = {
  bank_admin:     ['bank_credit_officer'],
  anchor_admin:   ['anchor_member'],
  supplier_admin: ['supplier_member'],
}

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

  if (!ADMIN_ROLES.includes(userData.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const query = BANK_ROLES.includes(userData.role)
    ? adminClient.from('invitations').select('id, email, role, status, expires_at, created_at').eq('bank_id', userData.bank_id).order('created_at', { ascending: false })
    : adminClient.from('invitations').select('id, email, role, status, expires_at, created_at').eq('anchor_org_id', userData.org_id).order('created_at', { ascending: false })

  const { data: invitations, error } = await query
  if (error) return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 })

  return NextResponse.json({ invitations })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData, error: userError } = await adminClient
    .from('users')
    .select('id, role, bank_id, org_id, full_name')
    .eq('id', user.id)
    .single()

  if (userError || !userData) {
    return NextResponse.json({ error: 'User not found' }, { status: 401 })
  }

  if (!ADMIN_ROLES.includes(userData.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { allowed } = rateLimit(`invitations:${userData.id}`, 5, 60000)
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : ''
  const role  = typeof body.role  === 'string' ? body.role  : ''

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
  }

  const allowedRoles = ALLOWED_INVITE_ROLES[userData.role] ?? []
  if (!allowedRoles.includes(role)) {
    return NextResponse.json({ error: 'Invalid role for your portal' }, { status: 400 })
  }

  const actorType = userData.role.startsWith('bank') ? 'bank'
    : userData.role.startsWith('anchor') ? 'anchor' : 'supplier'

  // Check for existing user in same org/bank
  const userCheckQuery = BANK_ROLES.includes(userData.role)
    ? adminClient.from('users').select('id').eq('email', email).eq('bank_id', userData.bank_id)
    : adminClient.from('users').select('id').eq('email', email).eq('org_id', userData.org_id)

  const { data: existingUser } = await userCheckQuery.maybeSingle()
  if (existingUser) {
    return NextResponse.json({ error: 'User already exists in your organization' }, { status: 400 })
  }

  // Check for existing pending invitation
  const invCheckQuery = BANK_ROLES.includes(userData.role)
    ? adminClient.from('invitations').select('id').eq('email', email).eq('bank_id', userData.bank_id).eq('status', 'pending')
    : adminClient.from('invitations').select('id').eq('email', email).eq('anchor_org_id', userData.org_id).eq('status', 'pending')

  const { data: existingInv } = await invCheckQuery.maybeSingle()
  if (existingInv) {
    return NextResponse.json({ error: 'An invitation has already been sent to this email' }, { status: 400 })
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const record: Record<string, unknown> = {
    email,
    role,
    invited_by_user_id: userData.id,
    invited_by_actor_type: actorType,
    status: 'pending',
    expires_at: expiresAt,
  }

  if (BANK_ROLES.includes(userData.role)) {
    record.bank_id = userData.bank_id
  } else {
    record.anchor_org_id = userData.org_id
  }

  const { data: invitation, error: insertError } = await adminClient
    .from('invitations')
    .insert(record)
    .select('id, email, token, expires_at')
    .single()

  if (insertError) {
    console.error('Insert invitation error:', insertError)
    return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 })
  }

  // Fire invite email — non-blocking
  ;(async () => {
    const orgResult = BANK_ROLES.includes(userData.role)
      ? await adminClient.from('banks').select('display_name, legal_name').eq('id', userData.bank_id).single()
      : await adminClient.from('organizations').select('legal_name').eq('id', userData.org_id).single()
    const orgData = orgResult.data as { display_name?: string; legal_name?: string } | null
    const orgName = (orgData?.display_name ?? orgData?.legal_name) ?? 'Strike SCF'
    await sendEmail({
      to:      invitation.email,
      subject: `You've been invited to join ${orgName} on Strike SCF`,
      html:    inviteEmailHtml({
        inviterName: userData.full_name ?? 'A colleague',
        orgName,
        role,
        token: invitation.token,
      }),
    })
  })().catch(() => {})

  return NextResponse.json({ invitation }, { status: 201 })
}
