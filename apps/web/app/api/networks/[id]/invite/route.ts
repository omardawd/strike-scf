import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import {
  sendEmail,
  networkInviteExistingOrgHtml,
  networkInviteNewEmailHtml,
} from '@/lib/email'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// G3.6 — POST /api/networks/[id]/invite
export async function POST(
  request: Request,
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

  if (me.role !== 'org_admin' || !me.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: network } = await adminClient
    .from('anchor_networks')
    .select('id, anchor_org_id, name')
    .eq('id', id)
    .single()

  if (!network) return NextResponse.json({ error: 'Network not found' }, { status: 404 })
  if (network.anchor_org_id !== me.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: anchorOrg } = await adminClient
    .from('organizations')
    .select('id, legal_name')
    .eq('id', me.org_id)
    .single()

  let body: {
    type: 'existing_org' | 'email'
    org_id?: string
    email?: string
    prefill_company_name?: string
    prefill_country?: string
    notes?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.type || !['existing_org', 'email'].includes(body.type)) {
    return NextResponse.json({ error: 'type must be existing_org or email' }, { status: 400 })
  }

  // -- Flow: existing_org --
  if (body.type === 'existing_org') {
    if (!body.org_id) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

    const { data: targetOrg } = await adminClient
      .from('organizations')
      .select('id, legal_name, type, primary_contact_email, network_visible')
      .eq('id', body.org_id)
      .single()

    if (!targetOrg) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    if (targetOrg.type !== 'supplier' && targetOrg.type !== 'both') {
      return NextResponse.json({ error: 'Target organization must be a supplier' }, { status: 400 })
    }

    // Check not already an active/invited/suspended member
    const { data: existing } = await adminClient
      .from('anchor_network_members')
      .select('id, status')
      .eq('network_id', id)
      .eq('supplier_org_id', body.org_id)
      .maybeSingle()

    if (existing && existing.status !== 'removed') {
      return NextResponse.json({
        error: `Organization is already a ${existing.status} member of this network`,
      }, { status: 400 })
    }

    const { data: member, error: insertErr } = await adminClient
      .from('anchor_network_members')
      .upsert({
        network_id:          id,
        supplier_org_id:     body.org_id,
        status:              'invited',
        invited_at:          new Date().toISOString(),
        invited_by_user_id:  me.id,
        buyer_notes:         body.notes ?? null,
        joined_at:           null,
        declined_at:         null,
        removed_at:          null,
        removed_by_user_id:  null,
      }, { onConflict: 'network_id,supplier_org_id' })
      .select()
      .single()

    if (insertErr || !member) {
      return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 })
    }

    // Notify all org_admin users of the target org
    const { data: targetUsers } = await adminClient
      .from('users')
      .select('id, email')
      .eq('org_id', body.org_id)
      .in('role', ['org_admin', 'org_member'])

    for (const u of targetUsers ?? []) {
      await adminClient.from('notifications').insert({
        user_id:   u.id,
        event:     'network_invitation_received',
        title:     `${anchorOrg?.legal_name ?? 'A buyer'} invited you to join their supplier network`,
        body:      `You have been invited to join "${network.name}" on Strike SCF.`,
        deep_link: '/networks',
        read:      false,
      })
    }

    // Send email to primary contact
    const contactEmail = targetOrg.primary_contact_email
    if (contactEmail) {
      try {
        await sendEmail({
          to:      contactEmail,
          subject: `${anchorOrg?.legal_name ?? 'A buyer'} has invited you to their supplier network on Strike SCF`,
          html:    networkInviteExistingOrgHtml({
            anchorName:         anchorOrg?.legal_name ?? 'A buyer',
            networkName:        network.name,
            networkDescription: null,
            personalNote:       body.notes ?? null,
          }),
        })
      } catch {
        // non-fatal
      }
    }

    return NextResponse.json({ member_id: member.id, status: 'invited' }, { status: 201 })
  }

  // -- Flow: email invite --
  if (!body.email) return NextResponse.json({ error: 'email required' }, { status: 400 })
  const inviteEmail = body.email.toLowerCase().trim()

  // Check if an existing user has this email
  const { data: existingUser } = await adminClient
    .from('users')
    .select('id, org_id')
    .eq('email', inviteEmail)
    .maybeSingle()

  if (existingUser?.org_id) {
    // Treat as existing org invite
    const { data: targetOrg } = await adminClient
      .from('organizations')
      .select('id, legal_name, type, primary_contact_email')
      .eq('id', existingUser.org_id)
      .single()

    if (targetOrg && (targetOrg.type === 'supplier' || targetOrg.type === 'both')) {
      const { data: existing } = await adminClient
        .from('anchor_network_members')
        .select('id, status')
        .eq('network_id', id)
        .eq('supplier_org_id', existingUser.org_id)
        .maybeSingle()

      if (!existing || existing.status === 'removed') {
        await adminClient.from('anchor_network_members').upsert({
          network_id:         id,
          supplier_org_id:    existingUser.org_id,
          status:             'invited',
          invited_at:         new Date().toISOString(),
          invited_by_user_id: me.id,
          buyer_notes:        body.notes ?? null,
          joined_at:          null,
          declined_at:        null,
          removed_at:         null,
          removed_by_user_id: null,
        }, { onConflict: 'network_id,supplier_org_id' })

        await adminClient.from('notifications').insert({
          user_id:   existingUser.id,
          event:     'network_invitation_received',
          title:     `${anchorOrg?.legal_name ?? 'A buyer'} invited you to join their supplier network`,
          body:      `You have been invited to join "${network.name}" on Strike SCF.`,
          deep_link: '/networks',
          read:      false,
        })

        try {
          await sendEmail({
            to:      inviteEmail,
            subject: `${anchorOrg?.legal_name ?? 'A buyer'} has invited you to their supplier network on Strike SCF`,
            html:    networkInviteExistingOrgHtml({
              anchorName:  anchorOrg?.legal_name ?? 'A buyer',
              networkName: network.name,
              personalNote: body.notes ?? null,
            }),
          })
        } catch { /* non-fatal */ }
      }

      return NextResponse.json({ member_status: 'invited', org_id: existingUser.org_id }, { status: 201 })
    }
  }

  // New email: create invite token
  const { data: tokenRow, error: tokenErr } = await adminClient
    .from('network_invite_tokens')
    .insert({
      network_id:           id,
      anchor_org_id:        me.org_id,
      invited_email:        inviteEmail,
      invited_by_user_id:   me.id,
      prefill_company_name: body.prefill_company_name ?? null,
      prefill_country:      body.prefill_country ?? null,
      status:               'pending',
    })
    .select()
    .single()

  if (tokenErr || !tokenRow) {
    return NextResponse.json({ error: 'Failed to create invite token' }, { status: 500 })
  }

  try {
    await sendEmail({
      to:      inviteEmail,
      subject: `${anchorOrg?.legal_name ?? 'A buyer'} has invited you to join their supplier network`,
      html:    networkInviteNewEmailHtml({
        anchorName:  anchorOrg?.legal_name ?? 'A buyer',
        networkName: network.name,
        inviteToken: tokenRow.token,
      }),
    })
  } catch { /* non-fatal */ }

  return NextResponse.json({ token_id: tokenRow.id, status: 'pending' }, { status: 201 })
}
