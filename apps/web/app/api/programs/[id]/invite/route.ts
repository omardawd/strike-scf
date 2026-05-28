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

  const email            = typeof body.email           === 'string' ? body.email.toLowerCase().trim() : ''
  const name             = typeof body.name            === 'string' ? body.name.trim() : ''
  const role             = typeof body.role            === 'string' ? body.role : ''
  const anchor_org_id    = typeof body.anchor_org_id   === 'string' ? body.anchor_org_id : null
  const invitation_mode  = typeof body.invitation_mode === 'string' ? body.invitation_mode : 'standard'
  const prefilled_kyb    = body.prefilled_kyb && typeof body.prefilled_kyb === 'object' && !Array.isArray(body.prefilled_kyb)
    ? body.prefilled_kyb as Record<string, unknown>
    : null
  const required_documents = Array.isArray(body.required_documents) ? body.required_documents : null

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
    .select('id, bank_id, financing_types')
    .eq('id', programId)
    .single()
  if (!program) return NextResponse.json({ error: 'Program not found' }, { status: 404 })

  if (userData.role === 'bank_admin' && program.bank_id !== userData.bank_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Check for existing active or pending-review invitation
  const { data: existingInv } = await adminClient
    .from('invitations')
    .select('id')
    .eq('email', email)
    .eq('program_id', programId)
    .in('status', ['pending', 'pending_bank_review'])
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

  // Anchor inviting supplier on non-DD program requires bank approval first
  const isDDProgram = ((program.financing_types ?? []) as string[]).includes('dynamic_discounting')
  const isAnchorInvitingSupplier = userData.role === 'anchor_admin' && role === 'supplier'
  const needsBankReview = isAnchorInvitingSupplier && !isDDProgram

  const record: Record<string, unknown> = {
    email,
    role:                   inviteRole,
    invited_by_user_id:     userData.id,
    invited_by_actor_type:  actorType,
    bank_id:                program.bank_id,
    program_id:             programId,
    status:                 needsBankReview ? 'pending_bank_review' : 'pending',
    expires_at:             expiresAt,
  }
  if (anchor_org_id) record.anchor_org_id = anchor_org_id
  record.invitation_mode = invitation_mode
  if (prefilled_kyb)     record.prefilled_kyb = prefilled_kyb
  if (required_documents) record.required_documents = required_documents
  if (name)              record.invitee_name = name

  const { data: invitation, error: insertError } = await adminClient
    .from('invitations')
    .insert(record)
    .select('id, email, token, expires_at')
    .single()

  if (insertError) {
    console.error('Program invite error:', insertError)
    return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 })
  }

  // Only send email immediately if not waiting for bank review
  if (!needsBankReview) {
    console.log('[invite] Sending email to:', invitation.email)
    ;(async () => {
      const { data: bankData } = await adminClient
        .from('banks')
        .select('display_name, legal_name')
        .eq('id', program.bank_id)
        .single()
      const orgName = (bankData?.display_name ?? bankData?.legal_name) ?? 'Strike SCF'
      const subject = invitation_mode === 'known_counterparty'
        ? `Your account is ready on Strike SCF`
        : invitation_mode === 'custom_kyb'
          ? `Complete your Strike SCF onboarding`
          : name
            ? `Hi ${name}, you've been invited to join ${orgName} on Strike SCF`
            : `You've been invited to join ${orgName} on Strike SCF`

      const baseHtml = inviteEmailHtml({
        inviterName: userData.full_name ?? 'A colleague',
        orgName,
        role:        inviteRole,
        token:       invitation.token,
      })

      const noteHtml = invitation_mode === 'known_counterparty'
        ? `<p style="font-family:sans-serif;font-size:14px;color:#555;margin:16px 24px">${orgName} has already set up your organization details. You just need to create your credentials to get started.</p>`
        : invitation_mode === 'custom_kyb'
          ? `<p style="font-family:sans-serif;font-size:14px;color:#555;margin:16px 24px">${orgName} has specified the documents required for your onboarding.</p>`
          : ''

      await sendEmail({
        to:      invitation.email,
        subject,
        html:    baseHtml + noteHtml,
      })
    })().catch(() => {})
  }

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

  const { invitation_id, action } = body

  if (typeof invitation_id !== 'string') {
    return NextResponse.json({ error: 'invitation_id is required' }, { status: 400 })
  }

  if (action === 'approve') {
    if (userData.role !== 'bank_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const invitation_mode = typeof body.invitation_mode === 'string' ? body.invitation_mode : 'standard'

    const { data: updated, error: updateError } = await adminClient
      .from('invitations')
      .update({ status: 'pending', invitation_mode })
      .eq('id', invitation_id)
      .eq('program_id', programId)
      .eq('status', 'pending_bank_review')
      .select('id, email, token, invitee_name')
      .single()

    if (updateError || !updated) {
      return NextResponse.json({ error: 'Invitation not found or already processed' }, { status: 404 })
    }

    // Send email to supplier now that bank approved
    ;(async () => {
      const { data: program } = await adminClient
        .from('programs')
        .select('bank_id')
        .eq('id', programId)
        .single()
      if (!program) return

      const { data: bankData } = await adminClient
        .from('banks')
        .select('display_name, legal_name')
        .eq('id', program.bank_id)
        .single()
      const orgName = (bankData?.display_name ?? bankData?.legal_name) ?? 'Strike SCF'
      const inviteeName = (updated as { invitee_name?: string }).invitee_name ?? ''
      const subject = inviteeName
        ? `Hi ${inviteeName}, you've been invited to join ${orgName} on Strike SCF`
        : `You've been invited to join ${orgName} on Strike SCF`

      const html = inviteEmailHtml({
        inviterName: userData.full_name ?? 'Your bank',
        orgName,
        role:        'supplier',
        token:       (updated as { token: string }).token,
      })

      await sendEmail({ to: updated.email, subject, html })
    })().catch(() => {})

    return NextResponse.json({ success: true })
  }

  if (action === 'decline') {
    if (userData.role !== 'bank_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: updated, error: updateError } = await adminClient
      .from('invitations')
      .update({ status: 'declined' })
      .eq('id', invitation_id)
      .eq('program_id', programId)
      .eq('status', 'pending_bank_review')
      .select('id')

    if (updateError) {
      console.error('Decline invitation error:', updateError)
      return NextResponse.json({ error: 'Failed to decline invitation' }, { status: 500 })
    }

    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'Invitation not found or already processed' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  }

  if (action === 'cancel') {
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

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
