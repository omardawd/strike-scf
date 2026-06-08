import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendEmail, networkSupplierJoinedEmailHtml } from '@/lib/email'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// G3.7 — POST /api/networks/[id]/accept
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  if (!['org_admin', 'org_member'].includes(me.role) || !me.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: membership } = await adminClient
    .from('anchor_network_members')
    .select('id, status, network_id')
    .eq('network_id', id)
    .eq('supplier_org_id', me.org_id)
    .maybeSingle()

  if (!membership) {
    return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
  }
  if (membership.status !== 'invited') {
    return NextResponse.json({ error: `Cannot accept — current status is ${membership.status}` }, { status: 400 })
  }

  const { data: updated, error: updateErr } = await adminClient
    .from('anchor_network_members')
    .update({ status: 'active', joined_at: new Date().toISOString() })
    .eq('id', membership.id)
    .select()
    .single()

  if (updateErr) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

  // Increment member_count
  const { data: currentNet } = await adminClient
    .from('anchor_networks')
    .select('id, anchor_org_id, name, member_count')
    .eq('id', id)
    .single()

  if (currentNet) {
    await adminClient
      .from('anchor_networks')
      .update({ member_count: (currentNet.member_count ?? 0) + 1 })
      .eq('id', id)
  }

  const { data: myOrg } = await adminClient
    .from('organizations')
    .select('id, legal_name')
    .eq('id', me.org_id)
    .single()

  const networkName = currentNet?.name ?? 'the network'
  const supplierName = myOrg?.legal_name ?? 'A supplier'

  // Notify anchor org admins
  if (currentNet?.anchor_org_id) {
    const { data: anchorUsers } = await adminClient
      .from('users')
      .select('id, email')
      .eq('org_id', currentNet.anchor_org_id)
      .in('role', ['org_admin', 'org_member'])

    const { data: anchorOrg } = await adminClient
      .from('organizations')
      .select('primary_contact_email')
      .eq('id', currentNet.anchor_org_id)
      .single()

    for (const u of anchorUsers ?? []) {
      await adminClient.from('notifications').insert({
        user_id:   u.id,
        event:     'network_member_joined',
        title:     `${supplierName} has joined your ${networkName} network`,
        body:      `${supplierName} accepted your invitation and is now an active member.`,
        deep_link: `/networks/${id}`,
        read:      false,
      })
    }

    if (anchorOrg?.primary_contact_email) {
      try {
        await sendEmail({
          to:      anchorOrg.primary_contact_email,
          subject: `${supplierName} has joined your ${networkName} network`,
          html:    networkSupplierJoinedEmailHtml({
            supplierName,
            networkName,
            networkId: id,
          }),
        })
      } catch { /* non-fatal */ }
    }
  }

  // Notify the supplier themselves
  await adminClient.from('notifications').insert({
    user_id:   me.id,
    event:     'network_joined',
    title:     `You are now a member of ${networkName}`,
    body:      `You have joined the ${networkName} supplier network. You can now see their private listings on Strike Place.`,
    deep_link: '/networks',
    read:      false,
  })

  return NextResponse.json({ membership: updated })
}
