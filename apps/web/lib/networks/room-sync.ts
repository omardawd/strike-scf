import { SupabaseClient } from '@supabase/supabase-js'

/**
 * Keeps a network's persistent private room's participants in sync with its
 * current active membership — every user at the owning org plus every user
 * at each active member org gets added; anyone whose org is no longer owner
 * or an active member gets removed. No-op if the network has no room yet
 * (rooms.network_id is nullable — a network only gets one lazily, on first
 * "Network Room" click via POST /api/networks/[id]/room).
 *
 * Call this after any membership-status change: accept, suspend, remove.
 */
export async function syncNetworkRoomParticipants(
  supabaseAdmin: SupabaseClient,
  networkId: string
): Promise<void> {
  const { data: room } = await supabaseAdmin
    .from('rooms')
    .select('id')
    .eq('network_id', networkId)
    .maybeSingle()
  if (!room) return

  const { data: network } = await supabaseAdmin
    .from('anchor_networks')
    .select('anchor_org_id')
    .eq('id', networkId)
    .single()
  if (!network) return

  const { data: activeMembers } = await supabaseAdmin
    .from('anchor_network_members')
    .select('supplier_org_id')
    .eq('network_id', networkId)
    .eq('status', 'active')

  const desiredOrgIds = Array.from(new Set<string>([
    network.anchor_org_id,
    ...(activeMembers ?? []).map((m: { supplier_org_id: string }) => m.supplier_org_id),
  ]))

  const { data: desiredUsers } = await supabaseAdmin
    .from('users')
    .select('id, org_id')
    .in('org_id', desiredOrgIds)
    .in('role', ['org_admin', 'org_member'])

  const { data: currentParticipants } = await supabaseAdmin
    .from('room_participants')
    .select('id, user_id, org_id')
    .eq('room_id', room.id)
    .not('org_id', 'is', null)

  const desiredUserIds = new Set((desiredUsers ?? []).map((u: { id: string }) => u.id))
  const currentUserIds = new Set((currentParticipants ?? []).map((p: { user_id: string }) => p.user_id))

  const toAdd = (desiredUsers ?? []).filter((u: { id: string }) => !currentUserIds.has(u.id))
  const toRemove = (currentParticipants ?? []).filter((p: { user_id: string }) => !desiredUserIds.has(p.user_id))

  if (toAdd.length > 0) {
    await supabaseAdmin.from('room_participants').insert(
      toAdd.map((u: { id: string; org_id: string }) => ({
        room_id: room.id,
        org_id:  u.org_id,
        user_id: u.id,
        role:    u.org_id === network.anchor_org_id ? 'owner' : 'participant',
      }))
    )
  }
  if (toRemove.length > 0) {
    await supabaseAdmin.from('room_participants').delete().in('id', toRemove.map((p: { id: string }) => p.id))
  }
}
