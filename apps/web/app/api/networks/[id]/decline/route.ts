import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// G3.8 — POST /api/networks/[id]/decline
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
    .select('id, status')
    .eq('network_id', id)
    .eq('supplier_org_id', me.org_id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
  if (membership.status !== 'invited') {
    return NextResponse.json({ error: `Cannot decline — current status is ${membership.status}` }, { status: 400 })
  }

  await adminClient
    .from('anchor_network_members')
    .update({ status: 'declined', declined_at: new Date().toISOString() })
    .eq('id', membership.id)

  const { data: network } = await adminClient
    .from('anchor_networks')
    .select('id, anchor_org_id, name')
    .eq('id', id)
    .single()

  const { data: myOrg } = await adminClient
    .from('organizations')
    .select('legal_name')
    .eq('id', me.org_id)
    .single()

  // In-platform notification to anchor only (no email for declines)
  if (network?.anchor_org_id) {
    const { data: anchorUsers } = await adminClient
      .from('users')
      .select('id')
      .eq('org_id', network.anchor_org_id)
      .in('role', ['org_admin', 'org_member'])

    for (const u of anchorUsers ?? []) {
      await adminClient.from('notifications').insert({
        user_id:   u.id,
        event:     'network_invitation_declined',
        title:     `${myOrg?.legal_name ?? 'A supplier'} has declined your network invitation`,
        body:      `They declined your invitation to join ${network.name}.`,
        deep_link: `/networks/${id}`,
        read:      false,
      })
    }
  }

  return NextResponse.json({ status: 'declined' })
}
