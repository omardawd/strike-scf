import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendEmail, networkRemovedEmailHtml } from '@/lib/email'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// G3.9 — PATCH /api/networks/[id]/members/[org_id]
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; org_id: string }> }
) {
  const { id, org_id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  if (me.role !== 'org_admin' || !me.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: network } = await adminClient
    .from('anchor_networks')
    .select('id, anchor_org_id')
    .eq('id', id)
    .single()

  if (!network) return NextResponse.json({ error: 'Network not found' }, { status: 404 })
  if (network.anchor_org_id !== me.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: membership } = await adminClient
    .from('anchor_network_members')
    .select('id, status')
    .eq('network_id', id)
    .eq('supplier_org_id', org_id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  let body: { buyer_notes?: string; status?: 'active' | 'suspended' }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (body.status && !['active', 'suspended'].includes(body.status)) {
    return NextResponse.json({ error: 'status must be active or suspended' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if ('buyer_notes' in body) updates.buyer_notes = body.buyer_notes ?? null
  if (body.status) updates.status = body.status

  const { data: updated, error } = await adminClient
    .from('anchor_network_members')
    .update(updates)
    .eq('id', membership.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  return NextResponse.json({ member: updated })
}

// G3.10 — DELETE /api/networks/[id]/members/[org_id]
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; org_id: string }> }
) {
  const { id, org_id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  if (me.role !== 'org_admin' || !me.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: network } = await adminClient
    .from('anchor_networks')
    .select('id, anchor_org_id, name, member_count')
    .eq('id', id)
    .single()

  if (!network) return NextResponse.json({ error: 'Network not found' }, { status: 404 })
  if (network.anchor_org_id !== me.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: membership } = await adminClient
    .from('anchor_network_members')
    .select('id, status')
    .eq('network_id', id)
    .eq('supplier_org_id', org_id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const wasActive = membership.status === 'active'

  await adminClient
    .from('anchor_network_members')
    .update({
      status:             'removed',
      removed_at:         new Date().toISOString(),
      removed_by_user_id: me.id,
    })
    .eq('id', membership.id)

  if (wasActive && (network.member_count ?? 0) > 0) {
    await adminClient
      .from('anchor_networks')
      .update({ member_count: network.member_count - 1 })
      .eq('id', id)
  }

  // Notify removed supplier
  const { data: supplierUsers } = await adminClient
    .from('users')
    .select('id, email')
    .eq('org_id', org_id)
    .in('role', ['org_admin', 'org_member'])

  const { data: anchorOrg } = await adminClient
    .from('organizations')
    .select('legal_name')
    .eq('id', me.org_id)
    .single()

  const { data: supplierOrg } = await adminClient
    .from('organizations')
    .select('primary_contact_email')
    .eq('id', org_id)
    .single()

  for (const u of supplierUsers ?? []) {
    await adminClient.from('notifications').insert({
      user_id:   u.id,
      event:     'network_member_removed',
      title:     `You have been removed from ${anchorOrg?.legal_name ?? 'a buyer'}'s ${network.name} network`,
      body:      `You no longer have access to ${network.name}'s private listings on Strike Place.`,
      deep_link: '/networks',
      read:      false,
    })
  }

  if (supplierOrg?.primary_contact_email) {
    try {
      await sendEmail({
        to:      supplierOrg.primary_contact_email,
        subject: `You have been removed from ${anchorOrg?.legal_name ?? 'a buyer'}'s ${network.name} network`,
        html:    networkRemovedEmailHtml({
          anchorName:  anchorOrg?.legal_name ?? 'a buyer',
          networkName: network.name,
        }),
      })
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({ status: 'removed' })
}
