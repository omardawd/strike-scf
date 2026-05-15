import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendEmail, inviteEmailHtml } from '@/lib/email'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: programId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, bank_id, org_id, full_name')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  if (userData.role !== 'bank_admin' && userData.role !== 'anchor_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const email         = typeof body.email          === 'string' ? body.email.toLowerCase().trim() : ''
  const name          = typeof body.name           === 'string' ? body.name.trim() : ''
  const role          = typeof body.role           === 'string' ? body.role : ''
  const anchor_org_id = typeof body.anchor_org_id  === 'string' ? body.anchor_org_id : null

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
  }
  if (!['anchor', 'supplier'].includes(role)) {
    return NextResponse.json({ error: 'role must be anchor or supplier' }, { status: 400 })
  }
  if (userData.role === 'anchor_admin' && role === 'anchor') {
    return NextResponse.json({ error: 'Anchor admins can only invite suppliers' }, { status: 403 })
  }
  if (role === 'supplier' && !anchor_org_id) {
    return NextResponse.json({ error: 'anchor_org_id is required when inviting a supplier' }, { status: 400 })
  }

  const { data: program } = await adminClient
    .from('programs')
    .select('id, bank_id')
    .eq('id', programId)
    .single()
  if (!program) return NextResponse.json({ error: 'Program not found' }, { status: 404 })

  if (userData.role === 'bank_admin' && program.bank_id !== userData.bank_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: existingInv } = await adminClient
    .from('invitations')
    .select('id')
    .eq('email', email)
    .eq('program_id', programId)
    .eq('status', 'pending')
    .maybeSingle()
  if (existingInv) {
    return NextResponse.json(
      { error: 'An invitation for this email already exists for this program' },
      { status: 400 }
    )
  }

  const inviteRole = role
  const actorType  = userData.role.startsWith('bank') ? 'bank' : 'anchor'
  const expiresAt  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const record: Record<string, unknown> = {
    email,
    role:                   inviteRole,
    invited_by_user_id:     userData.id,
    invited_by_actor_type:  actorType,
    bank_id:                program.bank_id,
    program_id:             programId,
    status:                 'pending',
    expires_at:             expiresAt,
  }
  if (anchor_org_id) record.anchor_org_id = anchor_org_id

  const { data: invitation, error: insertError } = await adminClient
    .from('invitations')
    .insert(record)
    .select('id, email, token, expires_at')
    .single()

  if (insertError) {
    console.error('Program invite error:', insertError)
    return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 })
  }

  console.log('[invite] Sending email to:', invitation.email)
  console.log('[invite] Invite URL:', `${process.env.NEXT_PUBLIC_APP_URL}/invite?token=${invitation.token}`)

  ;(async () => {
    const { data: bankData } = await adminClient
      .from('banks')
      .select('display_name, legal_name')
      .eq('id', program.bank_id)
      .single()
    const orgName = (bankData?.display_name ?? bankData?.legal_name) ?? 'Strike SCF'
    await sendEmail({
      to:      invitation.email,
      subject: name
        ? `Hi ${name}, you've been invited to join ${orgName} on Strike SCF`
        : `You've been invited to join ${orgName} on Strike SCF`,
      html:    inviteEmailHtml({
        inviterName: userData.full_name ?? 'A colleague',
        orgName,
        role:        inviteRole,
        token:       invitation.token,
      }),
    })
  })().catch(() => {})

  return NextResponse.json({ invitation_id: invitation.id, token: invitation.token }, { status: 201 })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: programId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, bank_id, org_id')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  if (userData.role !== 'bank_admin' && userData.role !== 'anchor_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { invitation_id, action } = body

  if (action !== 'cancel') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }
  if (typeof invitation_id !== 'string') {
    return NextResponse.json({ error: 'invitation_id is required' }, { status: 400 })
  }

  const { data: updated, error: updateError } = await adminClient
    .from('invitations')
    .update({ status: 'revoked' })
    .eq('id', invitation_id)
    .eq('program_id', programId)
    .eq('status', 'pending')
    .select('id')

  if (updateError) {
    console.error('Cancel invitation error:', updateError)
    return NextResponse.json({ error: 'Failed to cancel invitation' }, { status: 500 })
  }

  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Invitation not found or already cancelled' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
