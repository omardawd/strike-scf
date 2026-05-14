import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ADMIN_ROLES = ['bank_admin', 'anchor_admin', 'supplier_admin']
const BANK_ROLES  = ['bank_admin', 'bank_credit_officer']

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

  if (!ADMIN_ROLES.includes(userData.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const invitationId = body.id
  if (!invitationId) {
    return NextResponse.json({ error: 'Invitation id is required' }, { status: 400 })
  }

  // Fetch the invitation and verify it belongs to this admin's org/bank
  const { data: invitation, error: fetchError } = await adminClient
    .from('invitations')
    .select('id, status, bank_id, anchor_org_id')
    .eq('id', invitationId)
    .single()

  if (fetchError || !invitation) {
    return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
  }

  if (invitation.status !== 'pending') {
    return NextResponse.json({ error: 'Invitation is not pending' }, { status: 400 })
  }

  // Verify ownership
  if (BANK_ROLES.includes(userData.role)) {
    if (invitation.bank_id !== userData.bank_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  } else {
    if (invitation.anchor_org_id !== userData.org_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const { error: updateError } = await adminClient
    .from('invitations')
    .update({ status: 'revoked' })
    .eq('id', invitationId)

  if (updateError) {
    console.error('Cancel invitation error:', updateError)
    return NextResponse.json({ error: 'Failed to cancel invitation' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
