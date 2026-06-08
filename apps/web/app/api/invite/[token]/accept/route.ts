import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendEmail, networkSupplierJoinedEmailHtml } from '@/lib/email'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// G4.2 — POST /api/invite/[token]/accept — called after new org completes Tier 0 signup
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, role, org_id, email')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  if (!['org_admin', 'org_member'].includes(me.role) || !me.org_id) {
    return NextResponse.json({ error: 'Forbidden — must be an org member' }, { status: 403 })
  }

  const { data: tokenRow } = await adminClient
    .from('network_invite_tokens')
    .select('*')
    .eq('token', token)
    .maybeSingle()

  if (!tokenRow) return NextResponse.json({ error: 'Token not found' }, { status: 404 })
  if (tokenRow.status !== 'pending') {
    return NextResponse.json({ error: 'Token already used' }, { status: 400 })
  }
  if (new Date(tokenRow.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Token expired' }, { status: 400 })
  }
  if (tokenRow.invited_email.toLowerCase() !== (me.email ?? '').toLowerCase()) {
    return NextResponse.json({ error: 'Email does not match invitation' }, { status: 403 })
  }

  const { data: network } = await adminClient
    .from('anchor_networks')
    .select('id, name, anchor_org_id, member_count')
    .eq('id', tokenRow.network_id)
    .single()

  if (!network) return NextResponse.json({ error: 'Network not found' }, { status: 404 })

  // Create member row
  await adminClient
    .from('anchor_network_members')
    .upsert({
      network_id:         tokenRow.network_id,
      supplier_org_id:    me.org_id,
      status:             'active',
      invited_at:         tokenRow.created_at,
      invited_by_user_id: tokenRow.invited_by_user_id,
      joined_at:          new Date().toISOString(),
    }, { onConflict: 'network_id,supplier_org_id' })

  // Increment member_count
  await adminClient
    .from('anchor_networks')
    .update({ member_count: (network.member_count ?? 0) + 1 })
    .eq('id', tokenRow.network_id)

  // Mark token accepted
  await adminClient
    .from('network_invite_tokens')
    .update({
      status:              'accepted',
      accepted_at:         new Date().toISOString(),
      accepted_by_org_id:  me.org_id,
    })
    .eq('id', tokenRow.id)

  const { data: myOrg } = await adminClient
    .from('organizations')
    .select('legal_name')
    .eq('id', me.org_id)
    .single()

  const supplierName = myOrg?.legal_name ?? 'A supplier'

  // Notify anchor
  const { data: anchorUsers } = await adminClient
    .from('users')
    .select('id')
    .eq('org_id', network.anchor_org_id)
    .in('role', ['org_admin', 'org_member'])

  const { data: anchorOrg } = await adminClient
    .from('organizations')
    .select('legal_name, primary_contact_email')
    .eq('id', network.anchor_org_id)
    .single()

  for (const u of anchorUsers ?? []) {
    await adminClient.from('notifications').insert({
      user_id:   u.id,
      event:     'network_member_joined',
      title:     `${supplierName} has joined Strike and accepted your ${network.name} invitation`,
      body:      `${supplierName} signed up via your invite link and joined ${network.name}.`,
      deep_link: `/networks/${network.id}`,
      read:      false,
    })
  }

  if (anchorOrg?.primary_contact_email) {
    try {
      await sendEmail({
        to:      anchorOrg.primary_contact_email,
        subject: `${supplierName} has joined Strike and accepted your ${network.name} invitation`,
        html:    networkSupplierJoinedEmailHtml({
          supplierName,
          networkName: network.name,
          networkId:   network.id,
        }),
      })
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({
    network_id:   network.id,
    anchor_name:  anchorOrg?.legal_name ?? null,
    network_name: network.name,
  })
}
