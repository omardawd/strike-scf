import { adminClient } from '../admin'
import { sendEmail, networkInviteExistingOrgHtml, networkInviteNewEmailHtml } from '@/lib/email'

export interface AddNetworkMemberInput {
  org_id: string          // acting org — must own the network
  network_id: string
  target_org_id?: string  // an org already on Strike (use lookup_entities first)
  email?: string          // fallback — invite by email if the org isn't found/on Strike yet
  notes?: string
}

// Mirrors POST /api/networks/[id]/invite — kept in sync with that route's two
// flows (existing_org / email). One notable difference: this always resolves
// the acting org's OWNERSHIP of the network itself (the route trusts session
// auth for that; a tool call needs the same check done explicitly here since
// there's no session to fall back on).
export async function addNetworkMember(input: AddNetworkMemberInput) {
  if (!input.target_org_id && !input.email) {
    return { error: 'Provide either target_org_id (an org already on Strike) or email (to invite a new one).' }
  }

  const { data: network } = await adminClient
    .from('anchor_networks')
    .select('id, anchor_org_id, name')
    .eq('id', input.network_id)
    .single()

  if (!network) return { error: 'Network not found' }
  if (network.anchor_org_id !== input.org_id) {
    return { error: 'org_id does not own this network' }
  }

  const { data: anchorOrg } = await adminClient
    .from('organizations')
    .select('id, legal_name')
    .eq('id', input.org_id)
    .single()

  // -- Flow: existing_org --
  if (input.target_org_id) {
    if (input.target_org_id === input.org_id) {
      return { error: 'Cannot invite your own organization' }
    }

    const { data: targetOrg } = await adminClient
      .from('organizations')
      .select('id, legal_name, primary_contact_email')
      .eq('id', input.target_org_id)
      .single()
    if (!targetOrg) return { error: 'Organization not found' }

    const { data: existing } = await adminClient
      .from('anchor_network_members')
      .select('id, status')
      .eq('network_id', input.network_id)
      .eq('supplier_org_id', input.target_org_id)
      .maybeSingle()

    if (existing && existing.status !== 'removed') {
      return { error: `${targetOrg.legal_name} is already a ${existing.status} member of this network` }
    }

    const { data: member, error: insertErr } = await adminClient
      .from('anchor_network_members')
      .upsert({
        network_id:         input.network_id,
        supplier_org_id:    input.target_org_id,
        status:             'invited',
        invited_at:         new Date().toISOString(),
        buyer_notes:        input.notes ?? null,
        joined_at:          null,
        declined_at:        null,
        removed_at:         null,
        removed_by_user_id: null,
      }, { onConflict: 'network_id,supplier_org_id' })
      .select()
      .single()

    if (insertErr || !member) return { error: 'Failed to create invitation' }

    const { data: targetUsers } = await adminClient
      .from('users')
      .select('id')
      .eq('org_id', input.target_org_id)
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

    if (targetOrg.primary_contact_email) {
      try {
        await sendEmail({
          to:      targetOrg.primary_contact_email,
          subject: `${anchorOrg?.legal_name ?? 'A buyer'} has invited you to their supplier network on Strike SCF`,
          html:    networkInviteExistingOrgHtml({
            anchorName:         anchorOrg?.legal_name ?? 'A buyer',
            networkName:        network.name,
            networkDescription: null,
            personalNote:       input.notes ?? null,
          }),
        })
      } catch { /* non-fatal */ }
    }

    return {
      member_id:   member.id,
      status:      'invited',
      org_name:    targetOrg.legal_name,
      network_name: network.name,
    }
  }

  // -- Flow: email invite --
  const inviteEmail = input.email!.toLowerCase().trim()

  const { data: existingUser } = await adminClient
    .from('users')
    .select('id, org_id')
    .eq('email', inviteEmail)
    .maybeSingle()

  if (existingUser?.org_id && existingUser.org_id !== input.org_id) {
    const { data: targetOrg } = await adminClient
      .from('organizations')
      .select('id, legal_name')
      .eq('id', existingUser.org_id)
      .single()

    if (targetOrg) {
      const { data: existing } = await adminClient
        .from('anchor_network_members')
        .select('id, status')
        .eq('network_id', input.network_id)
        .eq('supplier_org_id', existingUser.org_id)
        .maybeSingle()

      if (!existing || existing.status === 'removed') {
        await adminClient.from('anchor_network_members').upsert({
          network_id:         input.network_id,
          supplier_org_id:    existingUser.org_id,
          status:             'invited',
          invited_at:         new Date().toISOString(),
          buyer_notes:        input.notes ?? null,
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
              anchorName:   anchorOrg?.legal_name ?? 'A buyer',
              networkName:  network.name,
              personalNote: input.notes ?? null,
            }),
          })
        } catch { /* non-fatal */ }
      }

      return { status: 'invited', org_id: existingUser.org_id, org_name: targetOrg.legal_name }
    }
  }

  // New email: create invite token
  const { data: tokenRow, error: tokenErr } = await adminClient
    .from('network_invite_tokens')
    .insert({
      network_id:           input.network_id,
      anchor_org_id:        input.org_id,
      invited_email:        inviteEmail,
      prefill_company_name: null,
      prefill_country:      null,
      status:               'pending',
    })
    .select()
    .single()

  if (tokenErr || !tokenRow) return { error: 'Failed to create invite token' }

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

  return { status: 'pending', token_id: tokenRow.id, email: inviteEmail }
}
